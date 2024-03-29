import { Stack, RemovalPolicy, CfnOutput, StackProps, Tags, Duration} from 'aws-cdk-lib';
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
          "StringLike": {
            "token.actions.githubusercontent.com:sub": "repo:ppvillarreal/phonebookApp:*"
          },
          "StringEquals": {
            "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
          }
        },
        'sts:AssumeRoleWithWebIdentity'
      ),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName('AmazonEC2ContainerRegistryFullAccess'),
      ],
    });

    // Add ECS deployment permissions to the GitHub Actions role
    const ecsDeployPolicy = new PolicyStatement({
      actions: [
        'ecs:UpdateService',
        'ecs:DescribeServices',
      ],
      resources: ['*'], // You should restrict this to the specific resources if possible
    });

    githubActionsRole.addToPolicy(ecsDeployPolicy);

    //role for container to have access to ddb table
    const taskRole = new Role(this, 'taskRole', {
      assumedBy: new ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: 'Allows container service to access DynamoDB',
    });

    const ddbPhonebookAccess = new PolicyStatement({
      actions: ['dynamodb:*'],
      resources: [table.tableArn], // Specify the ARN of the specific table
    });
    
    taskRole.addToPolicy(ddbPhonebookAccess);

    //role to build the service in fargate
    const executionRole = new Role(this, 'FargateExecutionRole', {
      assumedBy: new ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'), // Includes permissions for ECR
      ],
    });

    // Create the Fargate service with a specific tag
    const fargateService = new ecsp.ApplicationLoadBalancedFargateService(this, 'PhonebookApplication', {
      taskImageOptions: {
        image: ecs.ContainerImage.fromEcrRepository(ecrRepository, 'latest'),
        containerPort: 3001,
        taskRole: taskRole, // Attach the task role with DynamoDB access
        executionRole: executionRole,
        environment: { // Add environment variables
          "DYNAMODB_TABLE_NAME": table.tableName,
          "DYNAMODB_TABLE_ARN": table.tableArn,
          "SERVICE_REGION": this.region
        }
      },
      publicLoadBalancer: true,
      cpu: 256,
      memoryLimitMiB: 1024
    });

    // Add health check to the container
    // Set health check for the container
    fargateService.targetGroup.configureHealthCheck({
      path: "/health",
      interval: Duration.seconds(30),
      timeout: Duration.seconds(5),
      healthyThresholdCount: 2,
      unhealthyThresholdCount: 3,
      port: "3001"
    });

    new CfnOutput(this, 'RepositoryUri', {
      value: ecrRepository.repositoryUri,
    });

  }
}
