import { Runtime } from '@aws-cdk/aws-apprunner-alpha';
export declare const environmentConfig: {
    dynamoDbTableName: string;
    appRunnerRepositoryUrl: string;
    appRunnerBranch: string;
    appRunnerConnectionArn: string;
    appRunnerRuntime: Runtime;
    appRunnerPort: string;
    appRunnerStartCommand: string;
    appRunnerBuildCommand: string;
};
