const cdk = require("@aws-cdk/core");
const lambda = require("@aws-cdk/aws-lambda");
const rds = require("@aws-cdk/aws-rds");
const ec2 = require("@aws-cdk/aws-ec2"); //for vpc
const iam = require("@aws-cdk/aws-iam");
const apigateway = require("@aws-cdk/aws-apigateway");
//const path = require("path");
//const { randomBytes } = require("crypto");

class AwsStack extends cdk.Stack {
  /**
   *
   * @param {cdk.Construct} scope
   * @param {string} id
   * @param {cdk.StackProps=} props
   */
  constructor(scope, id, props) {
    super(scope, id, props);

    // VPC setup
    const vpc = new ec2.Vpc(this, "kth-vpc", {
      maxAzs: 2,
      natGateways: 0,
      enableDnsHostnames: true,
      enableDnsSupport: true,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: "isolatedSubnet",
          subnetType: ec2.SubnetType.ISOLATED,
        },
      ],
    });

    vpc.addInterfaceEndpoint("SnsEndpoint", {
      service: ec2.InterfaceVpcEndpointAwsService.SNS,
    });

    vpc.addInterfaceEndpoint("LogsEndpoint", {
      service: ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS,
    });

    vpc.addInterfaceEndpoint("LambdaEndpoint", {
      service: ec2.InterfaceVpcEndpointAwsService.LAMBDA,
    });

    const credentials = rds.Credentials.fromPassword(
      "syscdk",
      cdk.SecretValue.plainText("testing123!")
    );

    // RDS Postgres setup
    const db = new rds.DatabaseInstance(this, "teamfourdb", {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_12_5,
      }),
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.BURSTABLE3,
        ec2.InstanceSize.SMALL
      ),
      databaseName: "WHaaSDB",
      credentials,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.ISOLATED },
    });

    db.connections.allowFrom(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.tcp(db.dbInstanceEndpointPort)
    );

    const lambdaVpcPolicy = iam.ManagedPolicy.fromManagedPolicyArn(
      this,
      id,
      "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
    );

    const snsFullAccess = iam.ManagedPolicy.fromManagedPolicyArn(
      this,
      "team4-sns-test",
      "arn:aws:iam::aws:policy/AmazonSNSFullAccess"
    );

    const logsFullAccess = iam.ManagedPolicy.fromManagedPolicyArn(
      this,
      "team4-sns-test2",
      "arn:aws:iam::aws:policy/CloudWatchLogsFullAccess"
    );

    const lambdaVpcRole = new iam.Role(this, "vpcRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      description: "Lambda role that allows access to VPCs",
      managedPolicies: [lambdaVpcPolicy],
      roleName: "CaptainHook_lambdaVPCRole",
    });

    const lambdaVpcSnsRole = new iam.Role(this, "vpcSnsRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      description: "Lambda role that allows access to VPCs and SNS",
      managedPolicies: [lambdaVpcPolicy, snsFullAccess],
      roleName: "CaptainHook_lambdaVPCSNSRole",
    });

    const lambdaVpcSnsLogsRole = new iam.Role(this, "vpcSnsLogsRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      description: "Lambda role that allows access to VPCs, SNS, and CW Logs",
      managedPolicies: [lambdaVpcPolicy, snsFullAccess, logsFullAccess],
      roleName: "CaptainHook_lambdaVPCSNSLogsRole",
    });

    const snsFeedbackStatement = new iam.PolicyStatement({
      resources: ["*"],
      actions: [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents",
        "logs:PutMetricFilter",
        "logs:PutRetentionPolicy",
      ],
      effect: iam.Effect.ALLOW,
    });

    const successFeedbackRole = new iam.Role(this, "SNSSuccessFeedback", {
      assumedBy: new iam.ServicePrincipal("sns.amazonaws.com"),
      roleName: "SNSSuccessFeedback",
    });
    successFeedbackRole.addToPolicy(snsFeedbackStatement);

    const failureFeedbackRole = new iam.Role(this, "SNSFailureFeedback", {
      assumedBy: new iam.ServicePrincipal("sns.amazonaws.com"),
      roleName: "SNSFailureFeedback",
    });
    failureFeedbackRole.addToPolicy(snsFeedbackStatement);

    lambdaVpcSnsLogsRole.addToPolicy(
      new iam.PolicyStatement({
        resources: [successFeedbackRole.roleArn, failureFeedbackRole.roleArn],
        actions: ["iam:PassRole"],
        effect: iam.Effect.ALLOW,
      })
    );

    // Lambda Setups
    const dbSetup = new lambda.Function(this, "dbSetup", {
      runtime: lambda.Runtime.NODEJS_14_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset("./lambdas/resetDB"),
      timeout: cdk.Duration.seconds(5),
      role: lambdaVpcRole,
      vpc,
      environment: {
        DATABASE_USER: credentials.username,
        DATABASE_HOST: db.dbInstanceEndpointAddress,
        DATABASE_PORT: db.dbInstanceEndpointPort,
        DATABASE_NAME: "WHaaSDB",
        DATABASE_PASSWORD: credentials.password,
      },
    });
    const dbSetupIntegration = new apigateway.LambdaIntegration(dbSetup);

    const servicesLambda = new lambda.Function(this, "ManageServices", {
      runtime: lambda.Runtime.NODEJS_14_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset("./lambdas/services"),
      timeout: cdk.Duration.seconds(5),
      role: lambdaVpcRole,
      vpc,
      environment: {
        DATABASE_USER: credentials.username,
        DATABASE_HOST: db.dbInstanceEndpointAddress,
        DATABASE_PORT: db.dbInstanceEndpointPort,
        DATABASE_NAME: "WHaaSDB",
        DATABASE_PASSWORD: credentials.password,
      },
    });
    const servicesLambdaIntegration = new apigateway.LambdaIntegration(
      servicesLambda
    );

    const eventsLambda = new lambda.Function(this, "ManageEvents", {
      runtime: lambda.Runtime.NODEJS_14_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset("./lambdas/events"),
      timeout: cdk.Duration.seconds(5),
      role: lambdaVpcSnsRole,
      vpc,
      environment: {
        DATABASE_USER: credentials.username,
        DATABASE_HOST: db.dbInstanceEndpointAddress,
        DATABASE_PORT: db.dbInstanceEndpointPort,
        DATABASE_NAME: "WHaaSDB",
        DATABASE_PASSWORD: credentials.password,
      },
    });
    const eventsLambdaIntegration = new apigateway.LambdaIntegration(
      eventsLambda
    );

    const logsLambda = new lambda.Function(this, "ManageLogs", {
      runtime: lambda.Runtime.NODEJS_14_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset("./lambdas/logMessages"),
      timeout: cdk.Duration.seconds(5),
      role: lambdaVpcSnsRole,
      vpc,
      environment: {
        DATABASE_USER: credentials.username,
        DATABASE_HOST: db.dbInstanceEndpointAddress,
        DATABASE_PORT: db.dbInstanceEndpointPort,
        DATABASE_NAME: "WHaaSDB",
        DATABASE_PASSWORD: credentials.password,
      },
    });

    const eventTypesLambda = new lambda.Function(this, "ManageEventTypes", {
      runtime: lambda.Runtime.NODEJS_14_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset("./lambdas/eventTypes"),
      timeout: cdk.Duration.seconds(5),
      role: lambdaVpcSnsLogsRole,
      vpc,
      environment: {
        DATABASE_USER: credentials.username,
        DATABASE_HOST: db.dbInstanceEndpointAddress,
        DATABASE_PORT: db.dbInstanceEndpointPort,
        DATABASE_NAME: "WHaaSDB",
        DATABASE_PASSWORD: credentials.password,
        DESTINATION_ARN: logsLambda.functionArn,
        DESTINATION_NAME: logsLambda.functionName,
      },
    });
    const eventTypesLambdaIntegration = new apigateway.LambdaIntegration(
      eventTypesLambda
    );

    const messagesLambda = new lambda.Function(this, "ManageMessages", {
      runtime: lambda.Runtime.NODEJS_14_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset("./lambdas/messages"),
      timeout: cdk.Duration.seconds(5),
      role: lambdaVpcSnsRole,
      vpc,
      environment: {
        DATABASE_USER: credentials.username,
        DATABASE_HOST: db.dbInstanceEndpointAddress,
        DATABASE_PORT: db.dbInstanceEndpointPort,
        DATABASE_NAME: "WHaaSDB",
        DATABASE_PASSWORD: credentials.password,
      },
    });
    const messagesLambdaIntegration = new apigateway.LambdaIntegration(
      messagesLambda
    );

    const subscriptionsLambda = new lambda.Function(
      this,
      "ManageSubscriptions",
      {
        runtime: lambda.Runtime.NODEJS_14_X,
        handler: "index.handler",
        code: lambda.Code.fromAsset("./lambdas/subscriptions"),
        timeout: cdk.Duration.seconds(5),
        role: lambdaVpcSnsRole,
        vpc,

        environment: {
          DATABASE_USER: credentials.username,
          DATABASE_HOST: db.dbInstanceEndpointAddress,
          DATABASE_PORT: db.dbInstanceEndpointPort,
          DATABASE_NAME: "WHaaSDB",
          DATABASE_PASSWORD: credentials.password,
        },
      }
    );
    const subscriptionsLambdaIntegration = new apigateway.LambdaIntegration(
      subscriptionsLambda
    );

    const usersLambda = new lambda.Function(this, "ManageUsers", {
      runtime: lambda.Runtime.NODEJS_14_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset("./lambdas/users"),
      timeout: cdk.Duration.seconds(5),
      role: lambdaVpcRole,
      vpc,
      environment: {
        DATABASE_USER: credentials.username,
        DATABASE_HOST: db.dbInstanceEndpointAddress,
        DATABASE_PORT: db.dbInstanceEndpointPort,
        DATABASE_NAME: "WHaaSDB",
        DATABASE_PASSWORD: credentials.password,
      },
    });
    const usersLambdaIntegration = new apigateway.LambdaIntegration(
      usersLambda
    );

    // API Gateway Setup and Lambda/Route Integrations
    const api = new apigateway.RestApi(this, "CaptainHook", {
      endpointTypes: [apigateway.EndpointType.REGIONAL],
      deployOptions: { stageName: "v1" },
      defaultCorsPreflightOptions: { allowOrigins: ["*"] },
    });

    const API_KEY = "MyApiKeyThatIsAtLeast20Characters";

    const key = api.addApiKey("ApiKey", {
      apiKeyName: "myApiKey4",
      value: API_KEY,
    });

    const plan = api.addUsagePlan("UsagePlan", {
      name: "v1",
      description: "Enforce API Key requirement",
      apiStages: [{ api, stage: api.deploymentStage }],
    });

    plan.addApiKey(key);

    const dbSetupRoute = api.root.addResource("dbSetup");
    dbSetupRoute.addMethod("GET", dbSetupIntegration, { apiKeyRequired: true });

    const services = api.root.addResource("services");
    services.addMethod("GET", servicesLambdaIntegration, {
      apiKeyRequired: true,
    });
    services.addMethod("POST", servicesLambdaIntegration, {
      apiKeyRequired: true,
    });

    const service = services.addResource("{service_id}");
    service.addMethod("GET", servicesLambdaIntegration, {
      apiKeyRequired: true,
    });

    const eventTypes = service.addResource("event_types");
    eventTypes.addMethod("GET", eventTypesLambdaIntegration, {
      apiKeyRequired: true,
    });
    eventTypes.addMethod("POST", eventTypesLambdaIntegration, {
      apiKeyRequired: true,
    });

    const eventType = eventTypes.addResource("{event_type_id}");
    eventType.addMethod("GET", eventTypesLambdaIntegration, {
      apiKeyRequired: true,
    });

    const users = service.addResource("users");
    users.addMethod("GET", usersLambdaIntegration, { apiKeyRequired: true });
    users.addMethod("POST", usersLambdaIntegration, { apiKeyRequired: true });

    const user = users.addResource("{user_id}");
    user.addMethod("GET", usersLambdaIntegration, { apiKeyRequired: true });

    const events = user.addResource("events");
    events.addMethod("GET", eventsLambdaIntegration, { apiKeyRequired: true });
    events.addMethod("POST", eventsLambdaIntegration, { apiKeyRequired: true });

    const event = events.addResource("{event_id}");
    event.addMethod("GET", eventsLambdaIntegration, { apiKeyRequired: true });

    const messages = user.addResource("messages");
    messages.addMethod("GET", messagesLambdaIntegration, {
      apiKeyRequired: true,
    });

    const message = messages.addResource("{message_id}");
    message.addMethod("GET", messagesLambdaIntegration, {
      apiKeyRequired: true,
    });

    const resend = message.addResource("resend");
    resend.addMethod("POST", messagesLambdaIntegration, {
      apiKeyRequired: true,
    });

    const subscriptions = user.addResource("subscriptions");
    subscriptions.addMethod("GET", subscriptionsLambdaIntegration, {
      apiKeyRequired: true,
    });
    subscriptions.addMethod("POST", subscriptionsLambdaIntegration, {
      apiKeyRequired: true,
    });

    const subscription = subscriptions.addResource("{subscription_id}");
    subscription.addMethod("GET", subscriptionsLambdaIntegration, {
      apiKeyRequired: true,
    });

    const test = subscription.addResource("test");
    test.addMethod("POST", subscriptionsLambdaIntegration, {
      apiKeyRequired: true,
    });

    new cdk.CfnOutput(this, "API_KEY", {
      value: API_KEY,
      description: "Your brand new API Key",
      exportName: "apiKey",
    });

    new cdk.CfnOutput(this, "VpcCIDRBlock", {
      value: vpc.vpcCidrBlock,
      description: "VPC IPs",
      exportName: "vpcIps",
    });
  }
}

module.exports = { AwsStack };
