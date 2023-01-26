const { defaults: tsjPreset } = require('ts-jest/presets');

/** @returns {Promise<import('jest').Config>} */

module.exports = async () => {
	return {
		verbose: true,
		modulePathIgnorePatterns: [ '<rootDir>/dist' ],
		transform: {
			...tsjPreset.transform,
			'\\.[jt]s$': [
				'ts-jest', { tsconfig: '<rootDir>/src/tsconfig.json' }
			]
		}
	};
};