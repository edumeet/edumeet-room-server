/* eslint-disable no-unused-vars */
export type Next = () => Promise<void> | void;
export type Middleware<T> = (
	context: T,
	next: Next,
) => Promise<void> | void;

export type Pipeline<T> = {
	use: (...middlewares: Middleware<T>[]) => void;
	remove: (middleware: Middleware<T>) => void;
	execute: (context: T) => Promise<void | T>;
}

export const Pipeline = <T>(...middlewares: Middleware<T>[]): Pipeline<T> => {
	const stack: Middleware<T>[] = [ ...middlewares ];

	const use: Pipeline<T>['use'] = (...newMiddlewares): void => {
		stack.push(...newMiddlewares);
	};

	const remove: Pipeline<T>['remove'] = (middleware): void => {
		const index = stack.indexOf(middleware);

		if (index > -1) stack.splice(index, 1);
	};

	const execute: Pipeline<T>['execute'] = async (context): Promise<void> => {
		let prevIndex = -1;

		const runner = async (index: number): Promise<void> => {
			if (index === prevIndex)
				throw new Error('next() called multiple times');

			prevIndex = index;

			const middleware = stack[index];

			if (middleware)
				await middleware(context, () => runner(index + 1));
		};

		await runner(0);
	};

	return { use, remove, execute };
};