import { Stack, RemovalPolicy, CfnOutput, StackProps, Tags} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Repository } from 'aws-cdk-lib/aws-ecr';
import { Role, ServicePrincipal, OpenIdConnectProvider, FederatedPrincipal, ManagedPolicy, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Table, AttributeType, BillingMode } from 'aws-cdk-lib/aws-dynamodb';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecsp from 'aws-cdk-lib/aws-ecs-patterns';
import { environmentConfig } from './config';

export class PhonebookInfraStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Create a DynamoDB table
    const table = new Table(this, 'PhonebookTable', {
      tableName: environmentConfig.dynamoDbTableName,
      partitionKey: { name: 'id', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
    });

    table.applyRemovalPolicy(RemovalPolicy.DESTROY);

    // Create ECR Repository
    const ecrRepository = new Repository(this, 'PhonebookRepository', {
      removalPolicy: RemovalPolicy.DESTROY,
    })

    // Define an IAM role for GitHub Actions
    const oidcProvider = new OpenIdConnectProvider(this, 'GitHubOidcProvider', {
      url: 'https://token.actions.githubusercontent.com',
      clientIds: ['sts.amazonaws.com'],
    });

    const githubActionsRole = new Role(this, 'GitHubActionsRole', {
      assumedBy: new FederatedPrincipal(
        oidcProvider.openIdConnectProviderArn,
        {
          StringEquals: {
            'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
            'token.actions.githubusercontent.com:sub': `repo:${environmentConfig.appGithubRepo}`,
          },
        },
        'sts:AssumeRoleWithWebIdentity'
      ),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName('AmazonEC2ContainerRegistryFullAccess'),
      ],
    });

    //role for container to have access to ddb table
    const taskRole = new Role(this, 'taskRole', {
      assumedBy: new ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: 'Allows container service to access DynamoDB',
    });

    // Create the Fargate service with a specific tag
    const fargateService = new ecsp.ApplicationLoadBalancedFargateService(this, 'MyWebServer', {
      taskImageOptions: {
        image: ecs.ContainerImage.fromRegistry('nginx'),
        taskRole: taskRole, // Attach the task role with DynamoDB access
        environment: { // Add environment variables
          "DYNAMODB_TABLE_NAME": table.tableName,
          "DYNAMODB_TABLE_ARN": table.tableArn,
          "SERVICE_REGION": this.region
        }
      },
      publicLoadBalancer: true
    });

    // Add a tag to the task definition
    Tags.of(fargateService.taskDefinition).add('PhonebookTableAccess', 'allowed');

    // Restrict the role to be used only by tasks with the specific tag
    const conditionalPolicy = new PolicyStatement({
      actions: ['dynamodb:*'],
      resources: [table.tableArn], // Specify the ARN of the specific table
      conditions: {
        'StringEquals': {
          'aws:ResourceTag/PhonebookTableAccess': 'allowed'
        }
      }
    });
    
    // Add the conditional policy to the task role
    taskRole.addToPolicy(conditionalPolicy);

    new CfnOutput(this, 'RepositoryUri', {
      value: ecrRepository.repositoryUri,
    });

  }
}
