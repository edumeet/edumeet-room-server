export async function safePromise<T, R = Error>(promise: Promise<T>): Promise<[ null, T ] | [ R, null ]> {
	try {
		const data = await promise;
		
		return [ null, data ];
	} catch (error) {
		return [ error as R, null ];
	}
}
