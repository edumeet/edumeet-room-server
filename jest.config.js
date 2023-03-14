/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
	modulePathIgnorePatterns: [ '<rootDir>/dist' ],
	transform: {
		'^.+\\.[t]s$': [
			'ts-jest', { tsconfig: 'src/tsconfig.json' }
		]
	}
}