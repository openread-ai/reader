import ChatHistoryView from '../sidebar/ChatHistoryView';

export function MobileChatContent({
  bookKey,
  onConversationSelected,
}: {
  bookKey: string;
  onConversationSelected?: () => void;
}) {
  return <ChatHistoryView bookKey={bookKey} onConversationSelected={onConversationSelected} />;
}

export default MobileChatContent;
