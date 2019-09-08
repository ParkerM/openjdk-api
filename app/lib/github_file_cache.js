const _ = require('underscore');
const fs = require('fs');
const Q = require('q');
const octokit = require('@octokit/rest')();
const CronJob = require('cron').CronJob;

const logger = console;

const LOWEST_JAVA_VERSION = 8;
const HIGHEST_JAVA_VERSION = 12;

function readAuthCreds() {
  try {
    logger.log("Reading auth");
    var token;


    if (fs.existsSync('/home/jenkins/github.auth')) {
      token = fs.readFileSync('/home/jenkins/github.auth').toString("ascii").trim();
    } else if (process.env.GITHUB_TOKEN) {
      console.log("Using AUTH from GITHUB_TOKEN")
      token = process.env.GITHUB_TOKEN
    }

    if (token !== undefined) {
      octokit.authenticate({
        type: 'token',
        token: token
      });

      return true
    }

  } catch (e) {
    //ignore
    logger.warn("No github creds found");
  }

  return false;
}

function getCooldown(auth) {
  if (auth) {
    // 15 min
    return '0 */15 * * * *';
  } else {
    // 60 min
    return '0 */60 * * * *';
  }
}

function markOldReleases(oldReleases) {
  return _.chain(oldReleases)
    .map(function (release) {
      release.oldRepo = true;
      return release;
    })
    .value();
}

// This caches data returned by the github api to speed up response time and avoid going over github api rate limiting
class GitHubFileCache {

  constructor(disableCron) {
    this.auth = readAuthCreds();
    this.cache = {};
    this.repos = _.chain(_.range(LOWEST_JAVA_VERSION, HIGHEST_JAVA_VERSION + 1))
      .map(num => {
        return [
          `openjdk${num}-openj9-nightly`,
          `openjdk${num}-nightly`,
          `openjdk${num}-binaries`
        ]
      })
      .flatten()
      .values();

    if (disableCron !== true) {
      this.scheduleCacheRefresh();
    }
  }

  refreshCache(cache) {
    logger.info('Refresh at:', new Date());

    return _.chain(this.repos)
      .map(repo => this.getReleaseDataFromGithub(repo, cache))
      .value();
  }

  scheduleCacheRefresh() {
    const refresh = () => {
      try {
        const cache = {};
        Q.allSettled(this.refreshCache(cache))
          .then(() => {
            this.cache = cache;
            logger.info("Cache refreshed")
          })
      } catch (e) {
        logger.error(e)
      }
    };

    new CronJob(getCooldown(this.auth), refresh, undefined, true, undefined, undefined, true);
  }

  getReleaseDataFromGithub(repo, cache) {
    return octokit
      .paginate(`GET /repos/AdoptOpenJDK/${repo}/releases`, {
        owner: 'AdoptOpenJDK',
        repo: repo
      })
      .then(data => {
        cache[repo] = data;
        return data;
      });
  }

  cachedGet(repo) {
    const data = this.cache[repo];

    if (data === undefined) {
      return this.getReleaseDataFromGithub(repo, this.cache)
        .catch(error => {
          logger.error(`Error getting release data from GitHub: ${error}`);
          this.cache[repo] = [];
          return [];
        })
    } else {
      return Q(data);
    }
  }

  getInfoForVersion(version, releaseType) {

    const newRepoPromise = this.cachedGet(`${version}-binaries`);

    const legacyHotspotPromise = this.cachedGet(`${version}-${releaseType}`);
    let legacyOpenj9Promise;

    if (version.indexOf('amber') > 0) {
      legacyOpenj9Promise = Q({});
    } else {
      legacyOpenj9Promise = this.cachedGet(`${version}-openj9-${releaseType}`);
    }

    return Q.allSettled([
      newRepoPromise,
      legacyHotspotPromise,
      legacyOpenj9Promise
    ])
      .catch(error => {
        logger.error("failed to get", error);
        return [];
      })
      .spread(function (newData, oldHotspotData, oldOpenJ9Data) {
        if (newData.state === "fulfilled" || oldHotspotData.state === "fulfilled" || oldOpenJ9Data.state === "fulfilled") {
          newData = newData.state === "fulfilled" ? newData.value : [];
          oldHotspotData = oldHotspotData.state === "fulfilled" ? oldHotspotData.value : [];
          oldOpenJ9Data = oldOpenJ9Data.state === "fulfilled" ? oldOpenJ9Data.value : [];

          oldHotspotData = markOldReleases(oldHotspotData);
          oldOpenJ9Data = markOldReleases(oldOpenJ9Data);
          return _.union(newData, oldHotspotData, oldOpenJ9Data);
        } else {
          throw newData.reason;
        }
      });
  }
}

module.exports = GitHubFileCache;
