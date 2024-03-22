import { Stack, RemovalPolicy, CfnOutput, Duration, StackProps} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Repository } from 'aws-cdk-lib/aws-ecr';
import { Role, ServicePrincipal, OpenIdConnectProvider, FederatedPrincipal, ManagedPolicy } from 'aws-cdk-lib/aws-iam';
import { Table, AttributeType, BillingMode } from 'aws-cdk-lib/aws-dynamodb';
import { Vpc, SubnetType, SecurityGroup, Peer, Port } from 'aws-cdk-lib/aws-ec2';
import { Cluster, FargateTaskDefinition, ContainerImage, Protocol, FargateService } from 'aws-cdk-lib/aws-ecs';
import { ApplicationLoadBalancer} from 'aws-cdk-lib/aws-elasticloadbalancingv2';
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
    });

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

    // Create the Fargate ECS Service
    const vpc = new Vpc(this, 'PhonebookAppVpc', {
      maxAzs: 2,
    });

    const cluster = new Cluster(this, 'MyCluster', {
      vpc,
    });

    const taskDefinition = new FargateTaskDefinition(this, 'TaskDefinition', {
      memoryLimitMiB: 512,
      cpu: 256,
    });

    taskDefinition.addContainer('MyContainer', {
      image: ContainerImage.fromRegistry('nginx'),
      environment: {
        "DYNAMODB_TABLE_NAME": table.tableName,
        "DYNAMODB_TABLE_ARN": table.tableArn,
        "SERVICE_REGION": this.region
      },
      command: ['echo', 'Hello, world!'],
      portMappings: [
        {
          containerPort: 80,
          protocol: Protocol.TCP,
        }
      ]
    });

    const service = new FargateService(this, 'Service', {
      cluster,
      taskDefinition,
    });

    const phonebookDDBAccessRole = new Role(this, 'PhonebookDDBAccessRole', {
      assumedBy: new ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: 'Allows container service to access DynamoDB',
    });

    table.grantReadWriteData(phonebookDDBAccessRole);

    const albSecurityGroup = new SecurityGroup(this, 'ALBSecurityGroup', {
      vpc,
      securityGroupName: 'ALBSecurityGroup',
      description: 'Allow inbound traffic to ALB',
    });

    albSecurityGroup.addIngressRule(Peer.anyIpv4(), Port.tcp(80), 'Allow inbound HTTP traffic');

    const alb = new ApplicationLoadBalancer(this, 'ALB', {
      vpc,
      internetFacing: true,
      securityGroup: albSecurityGroup,
    });

    const listener = alb.addListener('Listener', {
      port: 80,
      open: true,
    });

    const targetGroup = listener.addTargets('ECSFargateService', {
      port: 80,
      targets: [service],
      healthCheck: {
        path: '/',
        interval: Duration.seconds(30),
      },
    });

    new CfnOutput(this, 'RepositoryUri', {
      value: ecrRepository.repositoryUri,
    });

    new CfnOutput(this, 'ALBDNSName', {
      value: alb.loadBalancerDnsName,
    });
  }
}
