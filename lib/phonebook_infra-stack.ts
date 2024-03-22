import * as cdk from '@aws-cdk/core';
import { Construct, RemovalPolicy } from '@aws-cdk/core';
import * as ec2 from '@aws-cdk/aws-ec2';
import { Vpc, SubnetType } from '@aws-cdk/aws-ec2';
import * as ecs from '@aws-cdk/aws-ecs';
import { Cluster } from '@aws-cdk/aws-ecs';
import { Table, AttributeType, BillingMode } from '@aws-cdk/aws-dynamodb'; 
import { Role, ServicePrincipal } from '@aws-cdk/aws-iam'; 
import { environmentConfig } from './config';
import * as ecr from '@aws-cdk/aws-ecr';
import * as iam from '@aws-cdk/aws-iam';
import * as elbv2 from '@aws-cdk/aws-elasticloadbalancingv2';

export class PhonebookInfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create a DynamoDB table
    const table = new Table(this, 'PhonebookTable', {
      tableName: environmentConfig.dynamoDbTableName,
      partitionKey: { name: 'id', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST, // Use on-demand billing mode
    });

    // This is not meant for production, so we will let table be destroyed
    table.applyRemovalPolicy(RemovalPolicy.DESTROY);

    // Create ECR Repository
    const ecrRepository = new ecr.Repository(this, 'PhonebookRepository', {
      removalPolicy: RemovalPolicy.DESTROY, // Optional: This sets the removal policy for the ECR repository
    });

    // Define an IAM role for GitHub Actions
    const githubActionsRole = new iam.Role(this, 'GitHubActionsRole', {
      assumedBy: new iam.FederatedPrincipal(
        'oidc-provider/token.actions.githubusercontent.com',
        {
          StringEquals: {
            'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
            'token.actions.githubusercontent.com:sub': `repo:${environmentConfig.appGithubRepo}`
          }
        },
        'sts:AssumeRoleWithWebIdentity'
      )
    });

    // Attach a policy to the IAM role that allows pushing images to the ECR repository
    githubActionsRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEC2ContainerRegistryFullAccess'));

    // Create the Fargate ECS Service
    const vpc = new Vpc(this, 'PhonebookAppVpc', {
      maxAzs: 2, // Max Availability Zones
    });

    const cluster = new Cluster(this, 'MyCluster', {
      vpc,
    });

    const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDefinition', {
      memoryLimitMiB: 512,
      cpu: 256,
    });

    // Add containers, environment variables, etc., to the task definition
    taskDefinition.addContainer('MyContainer', {
      image: ecs.ContainerImage.fromRegistry('nginx'),
      environment:{
        "DYNAMODB_TABLE_NAME": table.tableName,
        "DYNAMODB_TABLE_ARN": table.tableArn,
        "SERVICE_REGION": cdk.Stack.of(this).region
      },
      command: ['echo', 'Hello, world!']
    });

    const service = new ecs.FargateService(this, 'Service', {
      cluster,
      taskDefinition,
    });

    // Create an IAM role for Fargate container
    const PhonebookDDBAccessRole = new Role(this, 'PhonebookDDBAccessRole', {
      assumedBy: new ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: 'Allows container service to access DynamoDB',
    });

    // Grant the role permissions to access the DynamoDB table
    table.grantReadWriteData(PhonebookDDBAccessRole);    

    // Create a security group for the ALB
    const albSecurityGroup = new ec2.SecurityGroup(this, 'ALBSecurityGroup', {
      vpc,
      securityGroupName: 'ALBSecurityGroup',
      description: 'Allow inbound traffic to ALB',
    });

    albSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Allow inbound HTTP traffic');

    // Define the ALB
    const alb = new elbv2.ApplicationLoadBalancer(this, 'ALB', {
      vpc,
      internetFacing: true, // Expose the ALB to the internet
      securityGroup: albSecurityGroup,
    });

    // Define a listener for the ALB
    const listener = alb.addListener('Listener', {
      port: 80,
      open: true,
    });

    // Create a target group for the ALB
    const targetGroup = listener.addTargets('ECSFargateService', {
      port: 80,
      targets: [service],
      healthCheck: {
        path: '/',
        interval: cdk.Duration.seconds(30),
      },
    });

    // Output the ECR repository URI
    new cdk.CfnOutput(this, 'RepositoryUri', {
      value: ecrRepository.repositoryUri,
    });

    // Output the ALB DNS name
    new cdk.CfnOutput(this, 'ALBDNSName', {
      value: alb.loadBalancerDnsName,
    });

    new cdk.CfnOutput(this, 'Region', {
      value: cdk.Stack.of(this).region,
    });    

    // Output the IAM role ARN for GitHub Actions
    new cdk.CfnOutput(this, 'GitHubActionsRoleArn', {
      value: githubActionsRole.roleArn,
    });

    new cdk.CfnOutput(this, 'Region', {
      value: cdk.Stack.of(this).region,
    });

  }
}
