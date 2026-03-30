/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testRegex: '.*\\.e2e\\.spec\\.ts$',
  moduleFileExtensions: ['js', 'json', 'ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: {
        module: 'commonjs',
        esModuleInterop: true,
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        types: ['jest', 'node'],
        typeRoots: [
          '/tmp/test-deps/node_modules/@types',
          '/app/node_modules/@types',
        ],
      },
    }],
  },
  testTimeout: 90000,
};
