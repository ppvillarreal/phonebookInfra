import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import apprunner = require('@aws-cdk/aws-apprunner-alpha'); // Allows working with App Runner resources
import { DockerImageAsset } from 'aws-cdk-lib/aws-ecr-assets'; // Allows building the docker image and uploading to ECR
import * as path from "path"; // Helper for working with file paths
// import * as sqs from 'aws-cdk-lib/aws-sqs';

export class PhonebookInfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    
    new apprunner.Service(this, 'Service', {
      source: apprunner.Source.fromGitHub({
        repositoryUrl: 'https://github.com/ppvillarreal/phonebookApp/tree/main/backend',
        branch: 'main',
        configurationSource: apprunner.ConfigurationSourceType.API,
        codeConfigurationValues: {
          runtime: apprunner.Runtime.NODEJS_14,
          port: '3001',
          startCommand: 'npm start',
        },
        connection: apprunner.GitHubConnection.fromConnectionArn('arn:aws:apprunner:us-west-2:656805403368:connection/Github-ppvillarreal/149a900acde445208d8dbf9d89c67d38'),
      }),
    });
  }
}
