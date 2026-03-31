import ChatHistoryView from '../sidebar/ChatHistoryView';

export function MobileChatContent({ bookKey }: { bookKey: string }) {
  return <ChatHistoryView bookKey={bookKey} />;
}

export default MobileChatContent;
