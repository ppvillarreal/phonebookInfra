import { Runtime } from '@aws-cdk/aws-apprunner-alpha';

export const environmentConfig = {
    dynamoDbTableName: 'phonebookContacts',
    appRunnerRepositoryUrl: 'https://github.com/ppvillarreal/phonebookApp',
    appRunnerBranch: 'main',
    appRunnerConnectionArn: 'arn:aws:apprunner:us-west-2:656805403368:connection/Github-ppvillarreal/149a900acde445208d8dbf9d89c67d38',
    appRunnerRuntime: Runtime.NODEJS_14,
    appRunnerPort: '3001',
    appRunnerStartCommand: 'npm start',
    appRunnerBuildCommand: 'npm install && npm run build',
    appGithubRepo: 'ppvillarreal/phonebookApp'
  };