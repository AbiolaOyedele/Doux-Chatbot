export interface ChatAttachment {
  name: string;
  contentName: string;
  contentType: string;
  attachmentDataRef: {
    resourceName: string;
  };
  source: "UPLOADED_CONTENT" | "DRIVE_FILE";
}

export interface ChatSender {
  name: string;
  displayName: string;
  type: "HUMAN" | "BOT";
}

export interface ChatSpace {
  name: string;
  type: "ROOM" | "DM" | "GROUP_DM";
}

export interface ChatThread {
  name: string;
}

export interface ChatMessage {
  name: string;
  text: string;
  sender: ChatSender;
  space: ChatSpace;
  thread: ChatThread;
  attachment?: ChatAttachment[];
}

export interface ChatEvent {
  type: "MESSAGE" | "ADDED_TO_SPACE" | "REMOVED_FROM_SPACE" | "CARD_CLICKED";
  eventTime: string;
  message: ChatMessage;
  space: ChatSpace;
  user: ChatSender;
}

export interface PubSubEnvelope {
  message: {
    data: string;
    messageId: string;
    publishTime: string;
    attributes?: Record<string, string>;
  };
  subscription: string;
}
