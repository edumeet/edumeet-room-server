export const MAX_DISPLAY_NAME_LENGTH = 128;
export const MAX_CHAT_MESSAGE_LENGTH = 10000;

export const isValidText = (value: unknown, maxLength: number): value is string =>
	typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
