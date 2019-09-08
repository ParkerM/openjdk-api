const GitHubAuthService = require('../../app/lib/github_auth_service');

jest.mock('fs');

describe('GitHub auth service', () => {
  let fs;
  let mockExistsSync;
  let mockReadFileSync;

  let currentEnvToken;

  let authService;

  beforeEach(() => {
    mockExistsSync = jest.fn();
    mockReadFileSync = jest.fn();

    fs = require('fs');
    fs.existsSync = mockExistsSync;
    fs.readFileSync = mockReadFileSync;

    currentEnvToken = process.env.GITHUB_TOKEN;

    authService = new GitHubAuthService();
  });

  afterEach(() => {
    process.env.GITHUB_TOKEN = currentEnvToken; // restore existing env var
  });

  it('reads token from local auth file', () => {
    const localFilePath = '/home/jenkins/github.auth';
    const localFileToken = 'my-jenkins-token';
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(Buffer.alloc(localFileToken.length, localFileToken, 'ascii'));

    const creds = authService.readAuthCreds();

    expect(mockExistsSync).toHaveBeenCalledWith(localFilePath);
    expect(mockReadFileSync).toHaveBeenCalledWith(localFilePath);
    expect(creds).toEqual(localFileToken);
  });

  it('reads token from env var if local auth file does not exist', () => {
    fs.existsSync.mockReturnValue(false);
    const envToken = 'my-env-token';
    process.env.GITHUB_TOKEN = envToken;

    const creds = authService.readAuthCreds();

    expect(creds).toEqual(envToken);
  });

  it('returns undefined if local auth file or env var do not exist', () => {
    fs.existsSync.mockReturnValue(false);
    delete process.env.GITHUB_TOKEN;

    const creds = authService.readAuthCreds();

    expect(creds).toBeUndefined();
  });
});
