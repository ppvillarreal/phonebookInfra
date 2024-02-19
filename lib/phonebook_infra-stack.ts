import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as apprunner from '@aws-cdk/aws-apprunner-alpha'; 
import { Table, AttributeType, BillingMode } from 'aws-cdk-lib/aws-dynamodb'; 
import { Role, ServicePrincipal, PolicyStatement } from 'aws-cdk-lib/aws-iam';

export class PhonebookInfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create a DynamoDB table
    const table = new Table(this, 'PhonebookTable', {
      tableName: 'phonebookContacts', 
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

    // Create the App Runner service
    const service = new apprunner.Service(this, 'Service', {
      source: apprunner.Source.fromGitHub({
        repositoryUrl: 'https://github.com/ppvillarreal/phonebookApp',
        branch: 'main',
        configurationSource: apprunner.ConfigurationSourceType.API,
        codeConfigurationValues: {
          runtime: apprunner.Runtime.NODEJS_14,
          port: '3001',
          startCommand: 'npm start',
          buildCommand: 'npm run build',
        },
        connection: apprunner.GitHubConnection.fromConnectionArn('arn:aws:apprunner:us-west-2:656805403368:connection/Github-ppvillarreal/149a900acde445208d8dbf9d89c67d38'),
      }),
      // Associate the IAM role with the App Runner service
      instanceRole: appRunnerRole,
    });

    // Add environment variables to connect to DynamoDB
    service.addEnvironmentVariable("DYNAMODB_TABLE_NAME", table.tableName)
    service.addEnvironmentVariable("DYNAMODB_TABLE_ARN", table.tableArn)
    service.addEnvironmentVariable("SERVICE_REGION", cdk.Stack.of(this).region)

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
