module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    testMatch: ['<rootDir>/test/**/*.test.ts'], // Adjust the path based on your test file location
    setupFiles: ['dotenv/config'], // Optional: Load environment variables
    moduleNameMapper: {
      '^@/(.*)$': '<rootDir>/script/$1', // Optional: Alias for your `script/` directory
    },
    testPathIgnorePatterns: [
      '<rootDir>/test/management-new.test.ts',
      '<rootDir>/test/utils.test.ts'
    ],
  };
  