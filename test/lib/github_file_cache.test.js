const Octokit = require('@octokit/rest');
const GitHubFileCache = require('../../app/lib/github_file_cache');

const mockPaginate = jest.fn();
jest.mock('@octokit/rest', () => {
  return jest.fn().mockImplementation(() => {
    return {
      paginate: mockPaginate,
    }
  })
});

describe('GitHub file cache', () => {
  const authToken = 'test-token';

  let cache;
  let disableCron;
  let mockAuthService;

  beforeEach(() => {
    Octokit.mockClear();
    mockPaginate.mockClear();
    mockAuthService = {
      readAuthCreds: () => authToken,
    };
    disableCron = true;
  });

  it('initializes Octokit with authentication', () => {
    cache = new GitHubFileCache(mockAuthService, disableCron);
    expect(Octokit).toHaveBeenCalledWith({'auth': authToken});
  });

  it('readies repo strings for all java version in range', () => {
    const versionNums = [8, 9, 10, 11, 12, 13, 14, 15];
    const expectedRepoNames = [];
    versionNums.forEach(num => {
      expectedRepoNames.push(`openjdk${num}-openj9-nightly`);
      expectedRepoNames.push(`openjdk${num}-nightly`);
      expectedRepoNames.push(`openjdk${num}-binaries`);
    });

    const options = {minJavaVersion: 8, maxJavaVersion: 15};
    cache = new GitHubFileCache(mockAuthService, disableCron, options);

    expect(cache.repos).toEqual(expect.arrayContaining(expectedRepoNames));
  });

  describe('refreshCache', () => {

    const repoNameA = 'dummy-repo-a';
    const repoNameB = 'dummy-repo-b';

    beforeEach(() => {
      cache = new GitHubFileCache(mockAuthService, disableCron);
      cache.repos = [repoNameA, repoNameB];
    });

    it('fetches release data for each repo by name', () => {
      mockPaginate.mockReturnValue(Promise.resolve({}));

      return cache.refreshCache(cache).then(() => {
        expect(mockPaginate).toHaveBeenCalledWith(`GET /repos/:owner/:repo/releases`, {
          owner: 'AdoptOpenJDK',
          repo: 'dummy-repo-a',
        });
        expect(mockPaginate).toHaveBeenCalledWith(`GET /repos/:owner/:repo/releases`, {
          owner: 'AdoptOpenJDK',
          repo: 'dummy-repo-b',
        });
      });
    });

    it('replaces existing cache data', () => {
      expect(cache.cache).toEqual({});

      const repoDataA = {foo: 'Repo A data'};
      const repoDataB = {bar: 'Repo A data'};

      mockPaginate.mockImplementation((cmd, options) => {
        if (options['repo'] === repoNameA) return Promise.resolve(repoDataA);
        if (options['repo'] === repoNameB) return Promise.resolve(repoDataB);
      });

      return cache.refreshCache(cache.cache).then(() => {
        expect(cache.cache).toHaveProperty(repoNameA, repoDataA);
        expect(cache.cache).toHaveProperty(repoNameB, repoDataB);
      });
    });
  });

  describe('cachedGet', () => {

    const repoNameA = 'dummy-repo-a';
    const repoNameB = 'dummy-repo-b';

    beforeEach(() => {
      cache = new GitHubFileCache(mockAuthService, disableCron);
      cache.repos = [repoNameA, repoNameB];
    });

    it('returns cached data if exists', () => {
      cache.cache[repoNameA] = {cachedData: 'I am some cached data'};

      return cache.cachedGet(repoNameA).then(data => {
        expect(mockPaginate).not.toHaveBeenCalled();
        expect(data).toEqual({cachedData: 'I am some cached data'});
      });
    });

    it('fetches uncached repo data and updates cache', () => {
      expect(cache.cache).not.toHaveProperty(repoNameA);

      const newRepoDataA = {uncachedData: 'Cache me if you can!'};
      mockPaginate.mockReturnValue(Promise.resolve(newRepoDataA));

      return cache.cachedGet(repoNameA).then(data => {
        expect(mockPaginate).toHaveBeenCalled();
        expect(data).toEqual(newRepoDataA);
        expect(cache.cache).toHaveProperty(repoNameA, newRepoDataA);
      });
    });
  });
});
