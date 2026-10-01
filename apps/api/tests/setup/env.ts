// Per-test-file setup for integration tests: point the app at the test database.
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST ?? process.env.DATABASE_URL;
process.env.NODE_ENV = 'test';
