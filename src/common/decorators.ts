import { LoggerFactory } from './LoggerFactory';

// Add this decorator to any method, it will skip
// the method if the instance is closed.
export const skipIfClosed = (
	target: unknown,
	propertyKey: string,
	descriptor: PropertyDescriptor
) => {
	const originalValue = descriptor.value;

	descriptor.value = function(...args: unknown[]) {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		if ((this as any)?.closed) return;

		return originalValue.apply(this, args);
	};
};

const logger = LoggerFactory.getInstance();

type LogLevel = 'debug' | 'warn' | 'error';

export const log = (level: LogLevel) => {
	return (
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		target: any,
		methodName: string,
		descriptor: PropertyDescriptor
	) => {
		const originalValue = descriptor.value;

		descriptor.value = function(...args: unknown[]) {
			logger[level](`${target.constructor.name} ${methodName}() `, args);

			return originalValue.apply(this, args);
		};
	};
};