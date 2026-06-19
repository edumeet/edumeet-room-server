/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
	modulePathIgnorePatterns: [ '<rootDir>/dist' ],
	// Run only files following the `*.test.ts` convention (all unit + integration tests).
	testMatch: [ '**/__tests__/**/*.test.ts' ],
	transform: {
		'^.+\\.[t]s$': [
			'ts-jest', { tsconfig: 'src/tsconfig.json' }
		]
	}
}