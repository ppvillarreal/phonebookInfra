import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Stack } from '@aws-cdk/core';
import * as apprunner from '@aws-cdk/aws-apprunner-alpha'; 
import { Table, AttributeType, BillingMode } from 'aws-cdk-lib/aws-dynamodb'; 
import { Role, ServicePrincipal, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { environmentConfig } from './config';
import * as ecr from '@aws-cdk/aws-ecr';
import { RemovalPolicy } from '@aws-cdk/core';
import * as iam from '@aws-cdk/aws-iam';


export class PhonebookInfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create a DynamoDB table
    const table = new Table(this, 'PhonebookTable', {
      tableName: environmentConfig.dynamoDbTableName, 
      partitionKey: { name: 'id', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST, // Use on-demand billing mode
    });
    
    // Create an IAM role for App Runner
    const appRunnerRole = new Role(this, 'AppRunnerAccessRole', {
      assumedBy: new ServicePrincipal('tasks.apprunner.amazonaws.com'),
      description: 'Allows App Runner service to access DynamoDB',
    });

    // Grant the role permissions to access the DynamoDB table
    table.grantReadWriteData(appRunnerRole);
    // This is not meant for production, so we will let table be destroyed
    table.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

    // Create ECR Repository
    const ecrRepository = new ecr.Repository(Stack.of(this), 'PhonebookRepository', {
      removalPolicy: RemovalPolicy.DESTROY, // Optional: This sets the removal policy for the ECR repository
    });

    // Define an IAM role for GitHub Actions
    const githubActionsRole = new iam.Role(Stack.of(this), 'GitHubActionsRole', {
      assumedBy: new iam.FederatedPrincipal(
        'oidc-provider/token.actions.githubusercontent.com',
        {
          StringEquals: {
            'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
            'token.actions.githubusercontent.com:sub': 'repo:${environmentConfig.appGithubRepo}'
          }
        },
        'sts:AssumeRoleWithWebIdentity'
      )
    });

    // Attach a policy to the IAM role that allows pushing images to the ECR repository
    githubActionsRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEC2ContainerRegistryFullAccess'));

    // Create the App Runner service
    const service = new apprunner.Service(this, 'Service', {
      source: apprunner.Source.fromEcrPublic({
        imageConfiguration: { port: 8000 },
        imageIdentifier: 'public.ecr.aws/aws-containers/hello-app-runner:latest',
      }),
      // Associate the IAM role with the App Runner service
      instanceRole: appRunnerRole,
    });

    // Add environment variables to connect to DynamoDB
    service.addEnvironmentVariable("DYNAMODB_TABLE_NAME", table.tableName)
    service.addEnvironmentVariable("DYNAMODB_TABLE_ARN", table.tableArn)
    service.addEnvironmentVariable("SERVICE_REGION", cdk.Stack.of(this).region)

    // Output the ECR repository URI
    new cdk.CfnOutput(this, 'RepositoryUri', {
      value: ecrRepository.repositoryUri,
    });

    // Output the IAM role ARN for GitHub Actions
    new cdk.CfnOutput(this, 'GitHubActionsRoleArn', {
      value: githubActionsRole.roleArn,
    });

    // Optionally, output the DynamoDB table name and ARN
    new cdk.CfnOutput(this, 'TableName', {
      value: table.tableName,
    });

    new cdk.CfnOutput(this, 'TableArn', {
      value: table.tableArn,
    });

    new cdk.CfnOutput(this, 'Region', {
      value: cdk.Stack.of(this).region,
    });

    new cdk.CfnOutput(this, 'AppRunnerServiceURL', {
      value: service.serviceUrl,
    });
  }
}
