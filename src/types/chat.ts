// ── Google Workspace Add-on Chat event format ─────────────────────────────────
// Google Chat sends events in the Add-on format when the app is configured via
// the "Interactive features" path in the Google Chat API console.
// Top-level shape: { commonEventObject, chat }

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
  avatarUrl?: string;
  email?: string;
  type: "HUMAN" | "BOT";
}

export interface ChatSpace {
  name: string;
  type?: string;
  spaceType?: string;
  singleUserBotDm?: boolean;
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
  argumentText?: string;
}

// Add-on event (what Google actually sends via Pub/Sub)
export interface ChatEvent {
  commonEventObject?: {
    hostApp: string;
    platform: string;
  };
  // Add-on format: all Chat data is nested under "chat".
  // Google uses either "type" or "eventType" depending on the API version;
  // message is optional because non-MESSAGE events may omit it.
  chat?: {
    type?: "MESSAGE" | "ADDED_TO_SPACE" | "REMOVED_FROM_SPACE" | "CARD_CLICKED";
    eventType?: "MESSAGE" | "ADDED_TO_SPACE" | "REMOVED_FROM_SPACE" | "CARD_CLICKED";
    user: ChatSender;
    space: ChatSpace;
    message?: ChatMessage;
  };
  // Legacy flat format (kept for forward-compatibility)
  type?: "MESSAGE" | "ADDED_TO_SPACE" | "REMOVED_FROM_SPACE" | "CARD_CLICKED";
  eventTime?: string;
  message?: ChatMessage;
  space?: ChatSpace;
  user?: ChatSender;
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
