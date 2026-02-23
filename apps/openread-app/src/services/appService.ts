import { v4 as uuidv4 } from 'uuid';
import { SystemSettings } from '@/types/settings';
import {
  AppPlatform,
  AppService,
  DistChannel,
  FileItem,
  OsPlatform,
  ResolvedPath,
  SelectDirectoryMode,
} from '@/types/system';
import { FileSystem, BaseDir, DeleteAction } from '@/types/system';
import {
  Book,
  BookConfig,
  BookContent,
  BookFormat,
  FIXED_LAYOUT_FORMATS,
  ViewSettings,
} from '@/types/book';
import {
  getDir,
  getLocalBookFilename,
  getRemoteBookFilename,
  getCoverFilename,
  getConfigFilename,
  getLibraryFilename,
  INIT_BOOK_CONFIG,
  formatTitle,
  formatAuthors,
  getPrimaryLanguage,
  getLibraryBackupFilename,
} from '@/utils/book';
import { md5, partialMD5 } from '@/utils/md5';
import { getBaseFilename, getFilename } from '@/utils/path';
import { BookDoc, DocumentLoader, EXTS } from '@/libs/document';
import {
  DEFAULT_BOOK_LAYOUT,
  DEFAULT_BOOK_STYLE,
  DEFAULT_BOOK_FONT,
  DEFAULT_BOOK_LANGUAGE,
  DEFAULT_VIEW_CONFIG,
  DEFAULT_READSETTINGS,
  SYSTEM_SETTINGS_VERSION,
  DEFAULT_BOOK_SEARCH_CONFIG,
  DEFAULT_TTS_CONFIG,
  CLOUD_BOOKS_SUBDIR,
  DEFAULT_MOBILE_VIEW_SETTINGS,
  DEFAULT_SYSTEM_SETTINGS,
  DEFAULT_CJK_VIEW_SETTINGS,
  DEFAULT_MOBILE_READSETTINGS,
  DEFAULT_SCREEN_CONFIG,
  DEFAULT_TRANSLATOR_CONFIG,
  DEFAULT_FIXED_LAYOUT_VIEW_SETTINGS,
  SETTINGS_FILENAME,
  DEFAULT_MOBILE_SYSTEM_SETTINGS,
  DEFAULT_ANNOTATOR_CONFIG,
  DEFAULT_EINK_VIEW_SETTINGS,
} from './constants';
import { DEFAULT_AI_SETTINGS } from './ai/constants';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import {
  getOSPlatform,
  getTargetLang,
  isCJKEnv,
  isContentURI,
  isValidURL,
  makeSafeFilename,
} from '@/utils/misc';
import { deserializeConfig, serializeConfig } from '@/utils/serializer';
import { deleteFile } from '@/libs/storage';
import { ClosableFile } from '@/utils/file';
import { ProgressHandler } from '@/utils/transfer';
import { TxtToEpubConverter } from '@/utils/txt';
import { BOOK_FILE_NOT_FOUND_ERROR } from './errors';
import { CustomTextureInfo } from '@/styles/textures';
import { CustomFont, CustomFontInfo } from '@/styles/fonts';
import { parseFontInfo } from '@/utils/font';
import { svg2png } from '@/utils/svg';
import { transferManager } from '@/services/transferManager';
import { useSettingsStore } from '@/store/settingsStore';
import { createLogger } from '@/utils/logger';
import { CloudSyncService } from './cloudSync';
import { LibraryPersistence } from './libraryPersistence';

const logger = createLogger('appService');

export abstract class BaseAppService implements AppService {
  osPlatform: OsPlatform = getOSPlatform();
  appPlatform: AppPlatform = 'tauri';
  localBooksDir = '';
  isMobile = false;

  /** P13.15: Extracted cloud sync service (initialized in prepareBooksDir) */
  private _cloudSync: CloudSyncService | null = null;
  /** P13.15: Extracted library persistence service (initialized in prepareBooksDir) */
  private _persistence: LibraryPersistence | null = null;
  isMacOSApp = false;
  isLinuxApp = false;
  isAppDataSandbox = false;
  isAndroidApp = false;
  isIOSApp = false;
  isMobileApp = false;
  isPortableApp = false;
  isDesktopApp = false;
  isAppImage = false;
  isEink = false;
  hasTrafficLight = false;
  hasWindow = false;
  hasWindowBar = false;
  hasContextMenu = false;
  hasRoundedWindow = false;
  hasSafeAreaInset = false;
  hasHaptics = false;
  hasUpdater = false;
  hasOrientationLock = false;
  hasScreenBrightness = false;
  hasIAP = false;
  canCustomizeRootDir = false;
  canReadExternalDir = false;
  distChannel = 'openread' as DistChannel;
  storefrontRegionCode: string | null = null;
  isOnlineCatalogsAccessible = true;

  protected get cloudSync(): CloudSyncService {
    if (!this._cloudSync)
      throw new Error('CloudSyncService not initialized — call prepareBooksDir() first');
    return this._cloudSync;
  }

  protected get persistence(): LibraryPersistence {
    if (!this._persistence)
      throw new Error('LibraryPersistence not initialized — call prepareBooksDir() first');
    return this._persistence;
  }

  protected CURRENT_MIGRATION_VERSION = 20251124;

  protected abstract fs: FileSystem;
  protected abstract resolvePath(fp: string, base: BaseDir): ResolvedPath;

  abstract init(): Promise<void>;
  abstract setCustomRootDir(customRootDir: string): Promise<void>;
  abstract selectDirectory(mode: SelectDirectoryMode): Promise<string>;
  abstract selectFiles(name: string, extensions: string[]): Promise<string[]>;
  abstract saveFile(
    filename: string,
    content: string | ArrayBuffer,
    filepath: string,
    mimeType?: string,
  ): Promise<boolean>;
  abstract ask(message: string): Promise<boolean>;

  protected async runMigrations(lastMigrationVersion: number): Promise<void> {
    if (lastMigrationVersion < 20251124) {
      try {
        await this.migrate20251124();
      } catch (error) {
        logger.error('Error migrating to version 20251124:', error);
      }
    }
  }

  async prepareBooksDir() {
    this.localBooksDir = await this.fs.getPrefix('Books');
    // P13.15: Initialize extracted services after fs is available
    this._persistence = new LibraryPersistence(this.fs);
    this._cloudSync = new CloudSyncService(this.fs, this.localBooksDir, (path, base) =>
      this.resolveFilePath(path, base),
    );
  }

  async openFile(path: string, base: BaseDir): Promise<File> {
    return await this.fs.openFile(path, base);
  }

  async copyFile(srcPath: string, dstPath: string, base: BaseDir): Promise<void> {
    return await this.fs.copyFile(srcPath, dstPath, base);
  }

  async readFile(path: string, base: BaseDir, mode: 'text' | 'binary') {
    return await this.fs.readFile(path, base, mode);
  }

  async writeFile(path: string, base: BaseDir, content: string | ArrayBuffer | File) {
    return await this.fs.writeFile(path, base, content);
  }

  async createDir(path: string, base: BaseDir, recursive: boolean = true): Promise<void> {
    return await this.fs.createDir(path, base, recursive);
  }

  async deleteFile(path: string, base: BaseDir): Promise<void> {
    return await this.fs.removeFile(path, base);
  }

  async deleteDir(path: string, base: BaseDir, recursive: boolean = true): Promise<void> {
    return await this.fs.removeDir(path, base, recursive);
  }

  async resolveFilePath(path: string, base: BaseDir): Promise<string> {
    const prefix = await this.fs.getPrefix(base);
    return path ? `${prefix}/${path}` : prefix;
  }

  async readDirectory(path: string, base: BaseDir): Promise<FileItem[]> {
    return await this.fs.readDir(path, base);
  }

  async exists(path: string, base: BaseDir): Promise<boolean> {
    return await this.fs.exists(path, base);
  }

  async getImageURL(path: string): Promise<string> {
    return await this.fs.getImageURL(path);
  }

  getCoverImageUrl = (book: Book): string => {
    return this.fs.getURL(`${this.localBooksDir}/${getCoverFilename(book)}`);
  };

  getCoverImageBlobUrl = async (book: Book): Promise<string> => {
    return this.fs.getBlobURL(`${this.localBooksDir}/${getCoverFilename(book)}`, 'None');
  };

  async getCachedImageUrl(pathOrUrl: string): Promise<string> {
    const cachedKey = `img_${md5(pathOrUrl)}`;
    const cachePrefix = await this.fs.getPrefix('Cache');
    const cachedPath = `${cachePrefix}/${cachedKey}`;
    if (await this.fs.exists(cachedPath, 'None')) {
      return await this.fs.getImageURL(cachedPath);
    } else {
      const file = await this.fs.openFile(pathOrUrl, 'None');
      await this.fs.writeFile(cachedKey, 'Cache', await file.arrayBuffer());
      return await this.fs.getImageURL(cachedPath);
    }
  }

  getDefaultViewSettings(): ViewSettings {
    return {
      ...DEFAULT_BOOK_LAYOUT,
      ...DEFAULT_BOOK_STYLE,
      ...DEFAULT_BOOK_FONT,
      ...DEFAULT_BOOK_LANGUAGE,
      ...(this.isMobile ? DEFAULT_MOBILE_VIEW_SETTINGS : {}),
      ...(this.isEink ? DEFAULT_EINK_VIEW_SETTINGS : {}),
      ...(isCJKEnv() ? DEFAULT_CJK_VIEW_SETTINGS : {}),
      ...DEFAULT_VIEW_CONFIG,
      ...DEFAULT_TTS_CONFIG,
      ...DEFAULT_SCREEN_CONFIG,
      ...DEFAULT_ANNOTATOR_CONFIG,
      ...{ ...DEFAULT_TRANSLATOR_CONFIG, translateTargetLang: getTargetLang() },
    };
  }

  async loadSettings(): Promise<SystemSettings> {
    const defaultSettings: SystemSettings = {
      ...DEFAULT_SYSTEM_SETTINGS,
      ...(this.isMobile ? DEFAULT_MOBILE_SYSTEM_SETTINGS : {}),
      version: SYSTEM_SETTINGS_VERSION,
      localBooksDir: await this.fs.getPrefix('Books'),
      koreaderSyncDeviceId: uuidv4(),
      globalReadSettings: {
        ...DEFAULT_READSETTINGS,
        ...(this.isMobile ? DEFAULT_MOBILE_READSETTINGS : {}),
      },
      globalViewSettings: this.getDefaultViewSettings(),
    } as SystemSettings;

    let settings = await this.persistence.safeLoadJSON<SystemSettings>(
      SETTINGS_FILENAME,
      'Settings',
      defaultSettings,
    );

    const version = settings.version ?? 0;
    if (this.isAppDataSandbox || version < SYSTEM_SETTINGS_VERSION) {
      settings.version = SYSTEM_SETTINGS_VERSION;
    }
    settings = {
      ...DEFAULT_SYSTEM_SETTINGS,
      ...(this.isMobile ? DEFAULT_MOBILE_SYSTEM_SETTINGS : {}),
      ...settings,
    };
    settings.globalReadSettings = {
      ...DEFAULT_READSETTINGS,
      ...(this.isMobile ? DEFAULT_MOBILE_READSETTINGS : {}),
      ...settings.globalReadSettings,
    };
    settings.globalViewSettings = {
      ...this.getDefaultViewSettings(),
      ...settings.globalViewSettings,
    };
    settings.aiSettings = {
      ...DEFAULT_AI_SETTINGS,
      ...settings.aiSettings,
    };

    settings.localBooksDir = await this.fs.getPrefix('Books');

    if (!settings.kosync.deviceId) {
      settings.kosync.deviceId = uuidv4();
      await this.saveSettings(settings);
    }

    this.localBooksDir = settings.localBooksDir;
    this._cloudSync?.setLocalBooksDir(this.localBooksDir);
    return settings;
  }

  async saveSettings(settings: SystemSettings): Promise<void> {
    await this.persistence.safeSaveJSON(SETTINGS_FILENAME, 'Settings', settings);
  }

  async importFont(file?: string | File): Promise<CustomFontInfo | null> {
    let fontPath: string;
    let fontFile: File;
    if (typeof file === 'string') {
      const filePath = file;
      const fileobj = await this.fs.openFile(filePath, 'None');
      fontPath = fileobj.name || getFilename(filePath);
      await this.fs.copyFile(filePath, fontPath, 'Fonts');
      fontFile = await this.fs.openFile(fontPath, 'Fonts');
    } else if (file) {
      fontPath = getFilename(file.name);
      await this.fs.writeFile(fontPath, 'Fonts', file);
      fontFile = file;
    } else {
      return null;
    }

    return {
      path: fontPath,
      ...parseFontInfo(await fontFile.arrayBuffer(), fontPath),
    };
  }

  async deleteFont(font: CustomFont): Promise<void> {
    await this.fs.removeFile(font.path, 'Fonts');
  }

  async importImage(file?: string | File): Promise<CustomTextureInfo | null> {
    let imagePath: string;
    if (typeof file === 'string') {
      const filePath = file;
      const fileobj = await this.fs.openFile(filePath, 'None');
      imagePath = fileobj.name || getFilename(filePath);
      await this.fs.copyFile(filePath, imagePath, 'Images');
    } else if (file) {
      imagePath = getFilename(file.name);
      await this.fs.writeFile(imagePath, 'Images', file);
    } else {
      return null;
    }

    return {
      name: imagePath.replace(/\.[^/.]+$/, ''),
      path: imagePath,
    };
  }

  async deleteImage(texture: CustomTextureInfo): Promise<void> {
    await this.fs.removeFile(texture.path, 'Images');
  }

  async importBook(
    // file might be:
    // 1.1 absolute path for local file on Desktop
    // 1.2 /private/var inbox file path on iOS
    // 2. remote url
    // 3. content provider uri
    // 4. File object from browsers
    file: string | File,
    books: Book[],
    saveBook: boolean = true,
    saveCover: boolean = true,
    overwrite: boolean = false,
    transient: boolean = false,
  ): Promise<Book | null> {
    try {
      let loadedBook: BookDoc;
      let format: BookFormat;
      let filename: string;
      let fileobj: File;

      if (transient && typeof file !== 'string') {
        throw new Error('Transient import is only supported for file paths');
      }

      try {
        if (typeof file === 'string') {
          fileobj = await this.fs.openFile(file, 'None');
          filename = fileobj.name || getFilename(file);
        } else {
          fileobj = file;
          filename = file.name;
        }
        if (/\.txt$/i.test(filename)) {
          const txt2epub = new TxtToEpubConverter();
          ({ file: fileobj } = await txt2epub.convert({ file: fileobj }));
        }
        if (!fileobj || fileobj.size === 0) {
          throw new Error('Invalid or empty book file');
        }
        ({ book: loadedBook, format } = await new DocumentLoader(fileobj).open());
        if (!loadedBook) {
          throw new Error('Unsupported or corrupted book file');
        }
        const metadataTitle = formatTitle(loadedBook.metadata.title);
        if (!metadataTitle || !metadataTitle.trim() || metadataTitle === filename) {
          loadedBook.metadata.title = getBaseFilename(filename);
        }
      } catch (error) {
        throw new Error(`Failed to open the book: ${(error as Error).message || error}`);
      }

      const hash = await partialMD5(fileobj);
      const existingBook = books.filter((b) => b.hash === hash)[0];
      if (existingBook) {
        if (!transient) {
          existingBook.deletedAt = null;
        }
        existingBook.createdAt = Date.now();
        existingBook.updatedAt = Date.now();
      }

      const primaryLanguage = getPrimaryLanguage(loadedBook.metadata.language);
      const book: Book = {
        hash,
        format,
        title: formatTitle(loadedBook.metadata.title),
        sourceTitle: formatTitle(loadedBook.metadata.title),
        primaryLanguage,
        author: formatAuthors(loadedBook.metadata.author, primaryLanguage),
        createdAt: existingBook ? existingBook.createdAt : Date.now(),
        uploadedAt: existingBook ? existingBook.uploadedAt : null,
        deletedAt: transient ? Date.now() : null,
        downloadedAt: Date.now(),
        updatedAt: Date.now(),
      };
      // update book metadata when reimporting the same book
      if (existingBook) {
        existingBook.format = book.format;
        existingBook.title = existingBook.title.trim() ? existingBook.title.trim() : book.title;
        existingBook.sourceTitle = existingBook.sourceTitle ?? book.sourceTitle;
        existingBook.author = existingBook.author ?? book.author;
        existingBook.primaryLanguage = existingBook.primaryLanguage ?? book.primaryLanguage;
        existingBook.downloadedAt = Date.now();
      }

      if (!(await this.fs.exists(getDir(book), 'Books'))) {
        await this.fs.createDir(getDir(book), 'Books');
      }
      const bookFilename = getLocalBookFilename(book);
      if (saveBook && !transient && (!(await this.fs.exists(bookFilename, 'Books')) || overwrite)) {
        if (/\.txt$/i.test(filename)) {
          await this.fs.writeFile(bookFilename, 'Books', fileobj);
        } else if (typeof file === 'string' && isContentURI(file)) {
          await this.fs.copyFile(file, bookFilename, 'Books');
        } else if (typeof file === 'string' && !isValidURL(file)) {
          try {
            // try to copy the file directly first in case of large files to avoid memory issues
            // on desktop when reading recursively from selected directory the direct copy will fail
            // due to permission issues, then fallback to read and write files
            await this.fs.copyFile(file, bookFilename, 'Books');
          } catch (err) {
            logger.debug('Direct copy failed, falling back to read+write:', err);
            await this.fs.writeFile(bookFilename, 'Books', await fileobj.arrayBuffer());
          }
        } else {
          await this.fs.writeFile(bookFilename, 'Books', fileobj);
        }
      }
      if (saveCover && (!(await this.fs.exists(getCoverFilename(book), 'Books')) || overwrite)) {
        let cover = await loadedBook.getCover();
        if (cover?.type === 'image/svg+xml') {
          try {
            logger.info('Converting SVG cover to PNG...');
            cover = await svg2png(cover);
          } catch (err) {
            logger.warn('SVG to PNG conversion failed, using original SVG:', err);
          }
        }
        if (cover) {
          await this.fs.writeFile(getCoverFilename(book), 'Books', await cover.arrayBuffer());
        }
      }
      // Never overwrite the config file only when it's not existed
      if (!existingBook) {
        await this.saveBookConfig(book, INIT_BOOK_CONFIG);
        books.splice(0, 0, book);
      }

      // update file links with url or path or content uri
      if (typeof file === 'string') {
        if (isValidURL(file)) {
          book.url = file;
          if (existingBook) existingBook.url = file;
        }
        if (transient) {
          book.filePath = file;
          if (existingBook) existingBook.filePath = file;
        }
      }
      book.coverImageUrl = await this.generateCoverImageUrl(book);
      const f = file as ClosableFile;
      if (f && f.close) {
        await f.close();
      }

      // Auto-upload to cloud if enabled and not a transient import
      if (!transient) {
        const resultBook = existingBook || book;
        if (!resultBook.uploadedAt) {
          setTimeout(() => {
            try {
              const settings = useSettingsStore.getState().settings;
              const isReady = transferManager.isReady();
              logger.info('Auto-upload check:', {
                autoUpload: settings.autoUpload,
                transferManagerReady: isReady,
                bookHash: resultBook.hash,
              });
              if (settings.autoUpload && isReady) {
                logger.info('Queueing auto-upload for:', resultBook.title);
                transferManager.queueUpload(resultBook);
              } else {
                logger.warn('Auto-upload skipped:', {
                  reason: !settings.autoUpload
                    ? 'autoUpload disabled'
                    : 'transferManager not ready',
                });
              }
            } catch (e) {
              logger.warn('Auto-upload failed:', e);
            }
          }, 3000);
        } else {
          logger.info('Skipping auto-upload, book already uploaded:', resultBook.hash);
        }
      }

      return existingBook || book;
    } catch (error) {
      logger.error('Error importing book:', error);
      throw error;
    }
  }

  async deleteBook(book: Book, deleteAction: DeleteAction): Promise<void> {
    logger.info('Deleting book with action:', { deleteAction, title: book.title });
    if (deleteAction === 'local' || deleteAction === 'both') {
      const localDeleteFps =
        deleteAction === 'local'
          ? [getLocalBookFilename(book)]
          : [getLocalBookFilename(book), getCoverFilename(book)];
      for (const fp of localDeleteFps) {
        if (await this.fs.exists(fp, 'Books')) {
          await this.fs.removeFile(fp, 'Books');
        }
      }
      if (deleteAction === 'local') {
        book.downloadedAt = null;
      } else {
        book.deletedAt = Date.now();
        book.downloadedAt = null;
        book.coverDownloadedAt = null;
      }
    }
    if ((deleteAction === 'cloud' || deleteAction === 'both') && book.uploadedAt) {
      const fps = [getRemoteBookFilename(book), getCoverFilename(book)];
      for (const fp of fps) {
        logger.info('Deleting uploaded file:', fp);
        const cfp = `${CLOUD_BOOKS_SUBDIR}/${fp}`;
        try {
          await deleteFile(cfp);
        } catch (error) {
          logger.warn('Failed to delete uploaded file:', error);
        }
      }
      book.uploadedAt = null;
    }
  }

  /** P13.15: Delegates to CloudSyncService */
  async uploadFileToCloud(
    lfp: string,
    cfp: string,
    base: BaseDir,
    handleProgress: ProgressHandler,
    hash: string,
    temp: boolean = false,
  ) {
    return this.cloudSync.uploadFileToCloud(lfp, cfp, base, handleProgress, hash, temp);
  }

  async uploadBook(book: Book, onProgress?: ProgressHandler): Promise<void> {
    return this.cloudSync.uploadBook(book, onProgress);
  }

  async downloadCloudFile(lfp: string, cfp: string, onProgress: ProgressHandler) {
    return this.cloudSync.downloadCloudFile(lfp, cfp, onProgress, this);
  }

  async downloadBookCovers(books: Book[]): Promise<void> {
    return this.cloudSync.downloadBookCovers(books, this);
  }

  async downloadBook(
    book: Book,
    onlyCover = false,
    redownload = false,
    onProgress?: ProgressHandler,
  ): Promise<void> {
    return this.cloudSync.downloadBook(book, this, onlyCover, redownload, onProgress);
  }

  async exportBook(book: Book): Promise<boolean> {
    const { file } = await this.loadBookContent(book);
    const content = await file.arrayBuffer();
    const filename = `${makeSafeFilename(book.title)}.${book.format.toLowerCase()}`;
    const filepath = await this.resolveFilePath(getLocalBookFilename(book), 'Books');
    const fileType = file.type || 'application/octet-stream';
    return await this.saveFile(filename, content, filepath, fileType);
  }

  async isBookAvailable(book: Book): Promise<boolean> {
    const fp = getLocalBookFilename(book);
    if (await this.fs.exists(fp, 'Books')) {
      return true;
    }
    if (book.filePath) {
      return await this.fs.exists(book.filePath, 'None');
    }
    if (book.url) {
      return isValidURL(book.url);
    }
    return false;
  }

  async getBookFileSize(book: Book): Promise<number | null> {
    const fp = getLocalBookFilename(book);
    if (await this.fs.exists(fp, 'Books')) {
      const file = await this.fs.openFile(fp, 'Books');
      const size = file.size;
      const f = file as ClosableFile;
      if (f && f.close) {
        await f.close();
      }
      return size;
    }
    return null;
  }

  async loadBookContent(book: Book): Promise<BookContent> {
    let file: File;
    const fp = getLocalBookFilename(book);
    if (await this.fs.exists(fp, 'Books')) {
      file = await this.fs.openFile(fp, 'Books');
    } else if (book.filePath) {
      file = await this.fs.openFile(book.filePath, 'None');
    } else if (book.url) {
      file = await this.fs.openFile(book.url, 'None');
    } else {
      // 0.9.64 has a bug that book.title might be modified but the filename is not updated
      const bookDir = getDir(book);
      const files = await this.fs.readDir(getDir(book), 'Books');
      if (files.length > 0) {
        const bookFile = files.find((f) => f.path.endsWith(`.${EXTS[book.format]}`));
        if (bookFile) {
          file = await this.fs.openFile(`${bookDir}/${bookFile.path}`, 'Books');
        } else if (book.uploadedAt) {
          logger.info('Book file not found locally, downloading from cloud', book.hash);
          await this.downloadBook(book);
          file = await this.fs.openFile(fp, 'Books');
        } else {
          throw new Error(BOOK_FILE_NOT_FOUND_ERROR);
        }
      } else if (book.uploadedAt) {
        logger.info('Book directory empty, downloading from cloud', book.hash);
        await this.downloadBook(book);
        file = await this.fs.openFile(fp, 'Books');
      } else {
        throw new Error(BOOK_FILE_NOT_FOUND_ERROR);
      }
    }
    return { book, file };
  }

  async loadBookConfig(book: Book, settings: SystemSettings): Promise<BookConfig> {
    const globalViewSettings = {
      ...settings.globalViewSettings,
      ...(FIXED_LAYOUT_FORMATS.has(book.format) ? DEFAULT_FIXED_LAYOUT_VIEW_SETTINGS : {}),
    };
    try {
      let str = '{}';
      if (await this.fs.exists(getConfigFilename(book), 'Books')) {
        str = (await this.fs.readFile(getConfigFilename(book), 'Books', 'text')) as string;
      }
      return deserializeConfig(str, globalViewSettings, DEFAULT_BOOK_SEARCH_CONFIG);
    } catch (err) {
      logger.warn(`Failed to load config for "${book.title}", using defaults:`, err);
      return deserializeConfig('{}', globalViewSettings, DEFAULT_BOOK_SEARCH_CONFIG);
    }
  }

  async fetchBookDetails(book: Book) {
    const fp = getLocalBookFilename(book);
    if (!(await this.fs.exists(fp, 'Books')) && book.uploadedAt) {
      await this.downloadBook(book);
    }
    const { file } = await this.loadBookContent(book);
    const bookDoc = (await new DocumentLoader(file).open()).book;
    const f = file as ClosableFile;
    if (f && f.close) {
      await f.close();
    }
    return bookDoc.metadata;
  }

  async saveBookConfig(book: Book, config: BookConfig, settings?: SystemSettings) {
    let serializedConfig: string;
    if (settings) {
      const globalViewSettings = {
        ...settings.globalViewSettings,
        ...(FIXED_LAYOUT_FORMATS.has(book.format) ? DEFAULT_FIXED_LAYOUT_VIEW_SETTINGS : {}),
      };
      serializedConfig = serializeConfig(config, globalViewSettings, DEFAULT_BOOK_SEARCH_CONFIG);
    } else {
      serializedConfig = JSON.stringify(config);
    }
    await this.fs.writeFile(getConfigFilename(book), 'Books', serializedConfig);
  }

  async generateCoverImageUrl(book: Book): Promise<string | null> {
    const coverPath = getCoverFilename(book);
    const exists = await this.fs.exists(coverPath, 'Books');
    if (!exists) {
      logger.debug(`[cover] no file for "${book.title}" at ${coverPath}`);
      return null;
    }
    const url =
      this.appPlatform === 'web'
        ? await this.getCoverImageBlobUrl(book)
        : this.getCoverImageUrl(book);
    logger.debug(`[cover] generated url for "${book.title}": ${url?.slice(0, 60)}`);
    return url;
  }

  /** P13.15: Delegates to LibraryPersistence */
  async loadLibraryBooks(): Promise<Book[]> {
    return this.persistence.loadLibraryBooks((book) => this.generateCoverImageUrl(book));
  }

  async saveLibraryBooks(books: Book[]): Promise<void> {
    return this.persistence.saveLibraryBooks(books);
  }

  private imageToArrayBuffer(imageUrl?: string, imageFile?: string): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      if (!imageUrl && !imageFile) {
        reject(new Error('No image URL or file provided'));
        return;
      }
      if (this.appPlatform === 'web' && imageUrl && imageUrl.startsWith('blob:')) {
        fetch(imageUrl)
          .then((response) => response.arrayBuffer())
          .then((buffer) => resolve(buffer))
          .catch((error) => reject(error));
      } else if (this.appPlatform === 'tauri' && imageFile) {
        this.fs
          .openFile(imageFile, 'None')
          .then((file) => file.arrayBuffer())
          .then((buffer) => resolve(buffer))
          .catch((error) => reject(error));
      } else if (this.appPlatform === 'tauri' && imageUrl) {
        tauriFetch(imageUrl, { method: 'GET' })
          .then((response) => response.arrayBuffer())
          .then((buffer) => resolve(buffer))
          .catch((error) => reject(error));
      } else {
        reject(new Error('Unsupported platform or missing image data'));
      }
    });
  }

  async updateCoverImage(book: Book, imageUrl?: string, imageFile?: string): Promise<void> {
    if (imageUrl === '_blank') {
      await this.fs.removeFile(getCoverFilename(book), 'Books');
    } else if (imageUrl || imageFile) {
      const arrayBuffer = await this.imageToArrayBuffer(imageUrl, imageFile);
      await this.fs.writeFile(getCoverFilename(book), 'Books', arrayBuffer);
    }
  }

  private async migrate20251124(): Promise<void> {
    logger.info('Running migration for version 20251124 to rename the backup library file...');
    const oldBackupFilename = getLibraryBackupFilename();
    const newBackupFilename = `${getLibraryFilename()}.bak`;
    if (await this.fs.exists(oldBackupFilename, 'Books')) {
      try {
        const content = await this.fs.readFile(oldBackupFilename, 'Books', 'text');
        await this.fs.writeFile(newBackupFilename, 'Books', content);
        await this.fs.removeFile(oldBackupFilename, 'Books');
        logger.info('Migration to rename backup library file completed successfully.');
      } catch (error) {
        logger.error('Error during migration to rename backup library file:', error);
      }
    }
  }
}
