const fs = require('fs');

const logger = console;

class GitHubAuthService {

  constructor() {
    this.localTokenFilePath = '/home/jenkins/github.auth';
  }

  readAuthCreds() {
    let token = undefined;
    try {
      logger.info('Reading auth');

      if (fs.existsSync(this.localTokenFilePath)) {
        logger.info(`Using AUTH from file: ${this.localTokenFilePath}`);
        token = fs.readFileSync(this.localTokenFilePath).toString('ascii').trim();
      } else if (process.env.GITHUB_TOKEN) {
        logger.info('Using AUTH from GITHUB_TOKEN env var');
        token = process.env.GITHUB_TOKEN
      } else {
        logger.warn('No GitHub creds found. API calls will be anonymous.')
      }
    } catch (e) {
      logger.error(`Error reading GitHub creds: ${e}. API calls will be anonymous.`);
    }

    return token;
  }
}

module.exports = GitHubAuthService;
