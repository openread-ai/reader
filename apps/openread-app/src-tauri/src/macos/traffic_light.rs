use objc::{msg_send, sel, sel_impl};
use rand::{distributions::Alphanumeric, Rng};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{
    command,
    plugin::{Builder, TauriPlugin},
    Emitter, Runtime, Window,
};

static WINDOW_CONTROL_PAD: Mutex<(f64, f64)> = Mutex::new((10.0, 22.0));
static TRAFFIC_LIGHTS_VISIBLE: AtomicBool = AtomicBool::new(true);

/// Height of the native drag region overlay (matches Tailwind h-11 = 2.75rem = 44px)
const DRAG_REGION_HEIGHT: f64 = 44.0;

struct UnsafeWindowHandle(*mut std::ffi::c_void);
unsafe impl Send for UnsafeWindowHandle {}
unsafe impl Sync for UnsafeWindowHandle {}

/// Register a custom NSView subclass that handles window dragging synchronously.
///
/// On macOS with TitleBarStyle::Overlay, Tauri's built-in drag.js uses async IPC
/// (JS → Tokio → event proxy → main thread → [NSApp currentEvent]). By the time
/// the native drag_window() runs, [NSApp currentEvent] is stale and the drag fails.
///
/// This view sits on top of the webview in the titlebar area and handles mouseDown:
/// by calling performWindowDragWithEvent: synchronously with the original event.
fn get_drag_view_class() -> &'static objc::runtime::Class {
    use cocoa::base::id;
    use objc::declare::ClassDecl;
    use objc::runtime::{Class, Object, Sel, BOOL, YES};
    use std::sync::OnceLock;

    static CLASS: OnceLock<&'static Class> = OnceLock::new();

    CLASS.get_or_init(|| {
        let superclass = Class::get("NSView").unwrap();
        let mut decl = ClassDecl::new("OpenreadDragRegionView", superclass).unwrap();

        extern "C" fn mouse_down(this: &Object, _sel: Sel, event: id) {
            unsafe {
                let click_count: i64 = msg_send![event, clickCount];
                let window: id = msg_send![this, window];
                if window.is_null() {
                    return;
                }
                if click_count == 2 {
                    // Double-click toggles zoom (maximize), matching standard macOS behavior
                    let _: () = msg_send![window, zoom: this];
                } else {
                    // Synchronous drag — the event is fresh, no stale [NSApp currentEvent]
                    let _: () = msg_send![window, performWindowDragWithEvent: event];
                }
            }
        }

        extern "C" fn accepts_first_mouse(
            _this: &Object,
            _sel: Sel,
            _event: id,
        ) -> BOOL {
            // Accept clicks even when the window isn't focused, so users can
            // drag an unfocused window without an extra click to focus first
            YES
        }

        unsafe {
            decl.add_method(
                sel!(mouseDown:),
                mouse_down as extern "C" fn(&Object, Sel, id),
            );
            decl.add_method(
                sel!(acceptsFirstMouse:),
                accepts_first_mouse as extern "C" fn(&Object, Sel, id) -> BOOL,
            );
            &*decl.register()
        }
    })
}

/// Add a transparent native drag region overlay to the top of the window.
///
/// The view covers the full width × DRAG_REGION_HEIGHT area at the top, sitting
/// above the WKWebView but below the NSTitlebarContainerView (traffic light buttons).
/// Autoresizing keeps it pinned to the top edge on window resize.
fn setup_native_drag_region<R: Runtime>(window: Window<R>) {
    use cocoa::appkit::NSView;
    use cocoa::base::id;
    use cocoa::foundation::{NSPoint, NSRect, NSSize};

    unsafe {
        let ns_win = window
            .ns_window()
            .expect("NS Window should exist for drag region setup")
            as id;
        let drag_class = get_drag_view_class();
        let content_view: id = msg_send![ns_win, contentView];
        let content_frame: NSRect = NSView::frame(content_view);

        let frame = NSRect::new(
            NSPoint::new(0.0, content_frame.size.height - DRAG_REGION_HEIGHT),
            NSSize::new(content_frame.size.width, DRAG_REGION_HEIGHT),
        );

        let drag_view: id = msg_send![drag_class, alloc];
        let drag_view: id = msg_send![drag_view, initWithFrame: frame];

        // NSViewWidthSizable (2) | NSViewMinYMargin (8):
        // stretch width with superview, keep pinned to top (bottom margin is flexible)
        let mask: u64 = 2 | 8;
        let _: () = msg_send![drag_view, setAutoresizingMask: mask];

        // Place on top of all existing subviews (above WKWebView).
        // NSWindowAbove = 1, relativeTo nil = topmost
        let _: () = msg_send![
            content_view,
            addSubview: drag_view
            positioned: 1i64
            relativeTo: cocoa::base::nil
        ];
        // Balance alloc/init — addSubview: retains, so release our ownership
        let _: () = msg_send![drag_view, release];

        log::info!("Native drag region installed ({DRAG_REGION_HEIGHT}px)");
    }
}

/// Cap window size to 85% of the current monitor after window-state restoration.
/// This runs in on_window_ready (after tauri_plugin_window_state has restored
/// any saved dimensions), so it catches windows that are too large for the
/// current screen (e.g. after switching from an external monitor to laptop).
fn cap_window_to_screen<R: Runtime>(window: &Window<R>) {
    if let Ok(Some(monitor)) = window.current_monitor() {
        let size = monitor.size();
        let scale = monitor.scale_factor();
        let max_w = size.width as f64 / scale * 0.85;
        let max_h = size.height as f64 / scale * 0.85;

        if let Ok(current) = window.inner_size() {
            let cur_w = current.width as f64 / scale;
            let cur_h = current.height as f64 / scale;

            if cur_w > max_w || cur_h > max_h {
                let new_w = cur_w.min(max_w);
                let new_h = cur_h.min(max_h);
                let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize::new(
                    new_w, new_h,
                )));
                log::info!("Capped window size to {new_w:.0}x{new_h:.0} (screen {max_w:.0}x{max_h:.0})");
            }
        }
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("traffic_light")
        .on_window_ready(|window| {
            #[cfg(target_os = "macos")]
            {
                setup_traffic_light_positioner(window.clone());
                setup_native_drag_region(window.clone());
                cap_window_to_screen(&window);
            }
            let window_clone = window.clone();
            window.on_window_event(move |event| {
                let window = window_clone.clone();
                if let tauri::WindowEvent::ThemeChanged(_theme) = event {
                    #[cfg(target_os = "macos")]
                    setup_traffic_light_positioner(window);
                }
            });
        })
        .build()
}

#[command]
pub fn set_traffic_lights(window: Window, visible: bool, x: f64, y: f64) {
    TRAFFIC_LIGHTS_VISIBLE.store(visible, Ordering::Relaxed);
    {
        let mut pad = WINDOW_CONTROL_PAD.lock().unwrap_or_else(|e| e.into_inner());
        *pad = (x, y);
    }
    position_traffic_lights(
        UnsafeWindowHandle(window.ns_window().expect("Failed to create window handle")),
        visible,
        x,
        y,
    );
}

fn position_traffic_lights(ns_window_handle: UnsafeWindowHandle, visible: bool, x: f64, y: f64) {
    use cocoa::appkit::{NSView, NSWindow, NSWindowButton};
    use cocoa::foundation::NSRect;
    let ns_window = ns_window_handle.0 as cocoa::base::id;
    unsafe {
        let close = ns_window.standardWindowButton_(NSWindowButton::NSWindowCloseButton);
        let miniaturize =
            ns_window.standardWindowButton_(NSWindowButton::NSWindowMiniaturizeButton);
        let zoom = ns_window.standardWindowButton_(NSWindowButton::NSWindowZoomButton);

        let title_bar_container_view = close.superview().superview();

        let close_rect: NSRect = msg_send![close, frame];
        let button_height = close_rect.size.height;

        let mut title_bar_frame_height = button_height + y;
        if !visible {
            title_bar_frame_height = 0.0;
        }
        let mut title_bar_rect = NSView::frame(title_bar_container_view);
        title_bar_rect.size.height = title_bar_frame_height;
        title_bar_rect.origin.y = NSView::frame(ns_window).size.height - title_bar_frame_height;
        let _: () = msg_send![title_bar_container_view, setFrame: title_bar_rect];

        let window_buttons = vec![close, miniaturize, zoom];
        let space_between = NSView::frame(miniaturize).origin.x - NSView::frame(close).origin.x;

        for (i, button) in window_buttons.into_iter().enumerate() {
            let mut rect: NSRect = NSView::frame(button);
            rect.origin.x = x + (i as f64 * space_between);
            button.setFrameOrigin(rect.origin);
        }
    }
}

/// Read current traffic light state from globals and reposition.
/// Used by delegate callbacks that don't have the values locally.
fn reposition_traffic_lights(ns_window: *mut std::ffi::c_void) {
    let visible = TRAFFIC_LIGHTS_VISIBLE.load(Ordering::Relaxed);
    let (pad_x, pad_y) = *WINDOW_CONTROL_PAD.lock().unwrap_or_else(|e| e.into_inner());
    position_traffic_lights(UnsafeWindowHandle(ns_window), visible, pad_x, pad_y);
}

#[derive(Debug)]
struct WindowState<R: Runtime> {
    window: Window<R>,
}

pub fn setup_traffic_light_positioner<R: Runtime>(window: Window<R>) {
    use cocoa::appkit::NSWindow;
    use cocoa::base::{id, BOOL};
    use cocoa::foundation::NSUInteger;
    use objc::runtime::{Object, Sel};
    use std::ffi::c_void;

    // Do the initial positioning
    reposition_traffic_lights(window.ns_window().expect("Failed to create window handle"));

    // Ensure they stay in place while resizing the window.
    fn with_window_state<R: Runtime, F: FnOnce(&mut WindowState<R>) -> T, T>(
        this: &Object,
        func: F,
    ) {
        let ptr = unsafe {
            let x: *mut c_void = *this.get_ivar("app_box");
            &mut *(x as *mut WindowState<R>)
        };
        func(ptr);
    }

    unsafe {
        let ns_win = window
            .ns_window()
            .expect("NS Window should exist to mount traffic light delegate.")
            as id;

        let current_delegate: id = ns_win.delegate();

        extern "C" fn on_window_should_close(this: &Object, _cmd: Sel, sender: id) -> BOOL {
            unsafe {
                let super_del: id = *this.get_ivar("super_delegate");
                msg_send![super_del, windowShouldClose: sender]
            }
        }
        extern "C" fn on_window_will_close(this: &Object, _cmd: Sel, notification: id) {
            unsafe {
                let super_del: id = *this.get_ivar("super_delegate");
                let _: () = msg_send![super_del, windowWillClose: notification];
            }
        }
        extern "C" fn on_window_did_resize<R: Runtime>(this: &Object, _cmd: Sel, notification: id) {
            unsafe {
                with_window_state(this, |state: &mut WindowState<R>| {
                    if state.window.label() == "main" || state.window.label().starts_with("reader")
                    {
                        reposition_traffic_lights(
                            state.window.ns_window()
                                .expect("NS window should exist on state to handle resize"),
                        );
                    }
                });

                let super_del: id = *this.get_ivar("super_delegate");
                let _: () = msg_send![super_del, windowDidResize: notification];
            }
        }
        extern "C" fn on_window_did_move(this: &Object, _cmd: Sel, notification: id) {
            unsafe {
                let super_del: id = *this.get_ivar("super_delegate");
                let _: () = msg_send![super_del, windowDidMove: notification];
            }
        }
        extern "C" fn on_window_did_change_backing_properties(
            this: &Object,
            _cmd: Sel,
            notification: id,
        ) {
            unsafe {
                let super_del: id = *this.get_ivar("super_delegate");
                let _: () = msg_send![super_del, windowDidChangeBackingProperties: notification];
            }
        }
        extern "C" fn on_window_did_become_key(this: &Object, _cmd: Sel, notification: id) {
            unsafe {
                let super_del: id = *this.get_ivar("super_delegate");
                let _: () = msg_send![super_del, windowDidBecomeKey: notification];
            }
        }
        extern "C" fn on_window_did_resign_key(this: &Object, _cmd: Sel, notification: id) {
            unsafe {
                let super_del: id = *this.get_ivar("super_delegate");
                let _: () = msg_send![super_del, windowDidResignKey: notification];
            }
        }
        extern "C" fn on_dragging_entered(this: &Object, _cmd: Sel, notification: id) -> BOOL {
            unsafe {
                let super_del: id = *this.get_ivar("super_delegate");
                msg_send![super_del, draggingEntered: notification]
            }
        }
        extern "C" fn on_prepare_for_drag_operation(
            this: &Object,
            _cmd: Sel,
            notification: id,
        ) -> BOOL {
            unsafe {
                let super_del: id = *this.get_ivar("super_delegate");
                msg_send![super_del, prepareForDragOperation: notification]
            }
        }
        extern "C" fn on_perform_drag_operation(this: &Object, _cmd: Sel, sender: id) -> BOOL {
            unsafe {
                let super_del: id = *this.get_ivar("super_delegate");
                msg_send![super_del, performDragOperation: sender]
            }
        }
        extern "C" fn on_conclude_drag_operation(this: &Object, _cmd: Sel, notification: id) {
            unsafe {
                let super_del: id = *this.get_ivar("super_delegate");
                let _: () = msg_send![super_del, concludeDragOperation: notification];
            }
        }
        extern "C" fn on_dragging_exited(this: &Object, _cmd: Sel, notification: id) {
            unsafe {
                let super_del: id = *this.get_ivar("super_delegate");
                let _: () = msg_send![super_del, draggingExited: notification];
            }
        }
        extern "C" fn on_window_will_use_full_screen_presentation_options(
            this: &Object,
            _cmd: Sel,
            window: id,
            proposed_options: NSUInteger,
        ) -> NSUInteger {
            unsafe {
                let super_del: id = *this.get_ivar("super_delegate");
                msg_send![super_del, window: window willUseFullScreenPresentationOptions: proposed_options]
            }
        }
        extern "C" fn on_window_did_enter_full_screen<R: Runtime>(
            this: &Object,
            _cmd: Sel,
            notification: id,
        ) {
            unsafe {
                with_window_state(this, |state: &mut WindowState<R>| {
                    state
                        .window
                        .emit("did-enter-fullscreen", ())
                        .expect("Failed to emit event");
                });

                let super_del: id = *this.get_ivar("super_delegate");
                let _: () = msg_send![super_del, windowDidEnterFullScreen: notification];
            }
        }
        extern "C" fn on_window_will_enter_full_screen<R: Runtime>(
            this: &Object,
            _cmd: Sel,
            notification: id,
        ) {
            unsafe {
                with_window_state(this, |state: &mut WindowState<R>| {
                    state
                        .window
                        .emit("will-enter-fullscreen", ())
                        .expect("Failed to emit event");
                });

                let super_del: id = *this.get_ivar("super_delegate");
                let _: () = msg_send![super_del, windowWillEnterFullScreen: notification];
            }
        }
        extern "C" fn on_window_did_exit_full_screen<R: Runtime>(
            this: &Object,
            _cmd: Sel,
            notification: id,
        ) {
            unsafe {
                with_window_state(this, |state: &mut WindowState<R>| {
                    state
                        .window
                        .emit("did-exit-fullscreen", ())
                        .expect("Failed to emit event");

                    if state.window.label() == "main" || state.window.label().starts_with("reader")
                    {
                        reposition_traffic_lights(
                            state.window.ns_window()
                                .expect("NS window should exist to reposition traffic lights"),
                        );
                    }
                });

                let super_del: id = *this.get_ivar("super_delegate");
                let _: () = msg_send![super_del, windowDidExitFullScreen: notification];
            }
        }
        extern "C" fn on_window_will_exit_full_screen<R: Runtime>(
            this: &Object,
            _cmd: Sel,
            notification: id,
        ) {
            unsafe {
                with_window_state(this, |state: &mut WindowState<R>| {
                    state
                        .window
                        .emit("will-exit-fullscreen", ())
                        .expect("Failed to emit event");
                });

                let super_del: id = *this.get_ivar("super_delegate");
                let _: () = msg_send![super_del, windowWillExitFullScreen: notification];
            }
        }
        extern "C" fn on_window_did_fail_to_enter_full_screen(
            this: &Object,
            _cmd: Sel,
            window: id,
        ) {
            unsafe {
                let super_del: id = *this.get_ivar("super_delegate");
                let _: () = msg_send![super_del, windowDidFailToEnterFullScreen: window];
            }
        }
        extern "C" fn on_effective_appearance_did_change(
            this: &Object,
            _cmd: Sel,
            notification: id,
        ) {
            unsafe {
                let super_del: id = *this.get_ivar("super_delegate");
                let _: () = msg_send![super_del, effectiveAppearanceDidChange: notification];
            }
        }
        extern "C" fn on_effective_appearance_did_changed_on_main_thread(
            this: &Object,
            _cmd: Sel,
            notification: id,
        ) {
            unsafe {
                let super_del: id = *this.get_ivar("super_delegate");
                let _: () = msg_send![
                    super_del,
                    effectiveAppearanceDidChangedOnMainThread: notification
                ];
            }
        }

        // Are we deallocing this properly ? (I miss safe Rust :(  )
        let window_label = window.label().to_string();

        let app_state = WindowState { window };
        let app_box = Box::into_raw(Box::new(app_state)) as *mut c_void;
        let random_str: String = rand::thread_rng()
            .sample_iter(&Alphanumeric)
            .take(20)
            .map(char::from)
            .collect();

        // We need to ensure we have a unique delegate name, otherwise we will panic while trying to create a duplicate
        // delegate with the same name.
        let delegate_name = format!("windowDelegate_{}_{}", window_label, random_str);

        ns_win.setDelegate_(delegate!(&delegate_name, {
            window: id = ns_win,
            app_box: *mut c_void = app_box,
            toolbar: id = cocoa::base::nil,
            super_delegate: id = current_delegate,
            (windowShouldClose:) => on_window_should_close as extern "C" fn(&Object, Sel, id) -> BOOL,
            (windowWillClose:) => on_window_will_close as extern "C" fn(&Object, Sel, id),
            (windowDidResize:) => on_window_did_resize::<R> as extern "C" fn(&Object, Sel, id),
            (windowDidMove:) => on_window_did_move as extern "C" fn(&Object, Sel, id),
            (windowDidChangeBackingProperties:) => on_window_did_change_backing_properties as extern "C" fn(&Object, Sel, id),
            (windowDidBecomeKey:) => on_window_did_become_key as extern "C" fn(&Object, Sel, id),
            (windowDidResignKey:) => on_window_did_resign_key as extern "C" fn(&Object, Sel, id),
            (draggingEntered:) => on_dragging_entered as extern "C" fn(&Object, Sel, id) -> BOOL,
            (prepareForDragOperation:) => on_prepare_for_drag_operation as extern "C" fn(&Object, Sel, id) -> BOOL,
            (performDragOperation:) => on_perform_drag_operation as extern "C" fn(&Object, Sel, id) -> BOOL,
            (concludeDragOperation:) => on_conclude_drag_operation as extern "C" fn(&Object, Sel, id),
            (draggingExited:) => on_dragging_exited as extern "C" fn(&Object, Sel, id),
            (window:willUseFullScreenPresentationOptions:) => on_window_will_use_full_screen_presentation_options as extern "C" fn(&Object, Sel, id, NSUInteger) -> NSUInteger,
            (windowDidEnterFullScreen:) => on_window_did_enter_full_screen::<R> as extern "C" fn(&Object, Sel, id),
            (windowWillEnterFullScreen:) => on_window_will_enter_full_screen::<R> as extern "C" fn(&Object, Sel, id),
            (windowDidExitFullScreen:) => on_window_did_exit_full_screen::<R> as extern "C" fn(&Object, Sel, id),
            (windowWillExitFullScreen:) => on_window_will_exit_full_screen::<R> as extern "C" fn(&Object, Sel, id),
            (windowDidFailToEnterFullScreen:) => on_window_did_fail_to_enter_full_screen as extern "C" fn(&Object, Sel, id),
            (effectiveAppearanceDidChange:) => on_effective_appearance_did_change as extern "C" fn(&Object, Sel, id),
            (effectiveAppearanceDidChangedOnMainThread:) => on_effective_appearance_did_changed_on_main_thread as extern "C" fn(&Object, Sel, id)
        }))
    }
}
