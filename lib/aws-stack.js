const cdk = require("@aws-cdk/core");
const apigateway = require("@aws-cdk/aws-apigateway");
const lambda = require("@aws-cdk/aws-lambda");
const sns = require("@aws-cdk/aws-sns");
const ec2 = require("@aws-cdk/aws-ec2");
const rds = require("@aws-cdk/aws-rds");
const iam = require("@aws-cdk/aws-iam");
//const path = require("path");
class IamStack extends cdk.Stack {
  constructor(scope, id, props) {
    super(scope, id, props);

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
      roleName: "Tacklebox_lambdaVPCRole",
    });

    const lambdaVpcSnsRole = new iam.Role(this, "vpcSnsRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      description: "Lambda role that allows access to VPCs and SNS",
      managedPolicies: [lambdaVpcPolicy, snsFullAccess],
      roleName: "Tacklebox_lambdaVPCSNSRole",
    });

    const lambdaVpcSnsLogsRole = new iam.Role(this, "vpcSnsLogsRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      description: "Lambda role that allows access to VPCs, SNS, and CW Logs",
      managedPolicies: [lambdaVpcPolicy, snsFullAccess, logsFullAccess],
      roleName: "Tacklebox_lambdaVPCSNSLogsRole",
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

    lambdaVpcSnsLogsRole.addToPolicy(
      new iam.PolicyStatement({
        resources: ["*"],
        actions: ["lambda:AddPermission"],
        effect: iam.Effect.ALLOW,
      })
    );

    new cdk.CfnOutput(this, "lambdaVpcRole", {
      value: lambdaVpcRole.roleArn,
      description: "ARN for lambda's that need to connect to the VPC",
      exportName: "lambdaVpcRole",
    });

    new cdk.CfnOutput(this, "lambdaVpcSnsLogsRole", {
      value: lambdaVpcSnsLogsRole.roleArn,
      description:
        "ARN for lambda's that need to connect to the VPC, SNS, and CW Logs.",
      exportName: "lambdaVpcSnsLogsRole",
    });

    new cdk.CfnOutput(this, "lambdaVpcSnsRole", {
      value: lambdaVpcSnsRole.roleArn,
      description: "ARN for lambda's that need to connect to the VPC and SNS",
      exportName: "lambdaVpcSnsRole",
    });
  }
}

class TackleboxStack extends cdk.Stack {
  constructor(scope, id, props) {
    super(scope, id, props);

    // Role imports
    const lambdaVpcRole = iam.Role.fromRoleArn(
      this,
      "imported-role-1",
      props.lambdaVpcRoleArn
    );
    const lambdaVpcSnsRole = iam.Role.fromRoleArn(
      this,
      "imported-role-2",
      props.lambdaVpcSnsRoleArn
    );
    const lambdaVpcSnsLogsRole = iam.Role.fromRoleArn(
      this,
      "imported-role-3",
      props.lambdaVpcSnsLogsRoleArn
    );

    // VPC setup
    const vpc = new ec2.Vpc(this, "tacklebox-vpc", {
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
      "tackleboxadmin",
      cdk.SecretValue.plainText("testing123!")
    );

    // RDS Postgres setup
    const db = new rds.DatabaseInstance(this, "tackleboxdb", {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_12_5,
      }),
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.BURSTABLE3,
        ec2.InstanceSize.SMALL
      ),
      databaseName: "tacklebox",
      credentials,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.ISOLATED },
    });

    db.connections.allowFrom(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.tcp(db.dbInstanceEndpointPort)
    );

    const retryTopic = new sns.Topic(this, "Topic", {
      topicName: "Tacklebox_manual_message",
    });

    const lambdaEnvironment = {
      DATABASE_USER: credentials.username,
      DATABASE_HOST: db.dbInstanceEndpointAddress,
      DATABASE_PORT: db.dbInstanceEndpointPort,
      DATABASE_NAME: "tacklebox",
      DATABASE_PASSWORD: credentials.password,
    };

    // Lambda Setups
    const dbSetupLambda = new lambda.Function(this, "dbSetup", {
      runtime: lambda.Runtime.NODEJS_14_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset("./lambdas/resetDB"),
      timeout: cdk.Duration.seconds(5),
      role: lambdaVpcRole,
      vpc,
      environment: lambdaEnvironment,
    });

    const servicesLambda = new lambda.Function(this, "ManageServices", {
      runtime: lambda.Runtime.NODEJS_14_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset("./lambdas/services"),
      timeout: cdk.Duration.seconds(5),
      role: lambdaVpcSnsRole,
      vpc,
      environment: lambdaEnvironment,
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
      environment: lambdaEnvironment,
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
      environment: lambdaEnvironment,
    });

    const eventTypesLambda = new lambda.Function(this, "ManageEventTypes", {
      runtime: lambda.Runtime.NODEJS_14_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset("./lambdas/eventTypes"),
      timeout: cdk.Duration.seconds(5),
      role: lambdaVpcSnsLogsRole,
      vpc,
      environment: {
        ...lambdaEnvironment,
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
      environment: { ...lambdaEnvironment, RESEND_ARN: retryTopic.topicArn },
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
        environment: { ...lambdaEnvironment, RESEND_ARN: retryTopic.topicArn },
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
      role: lambdaVpcSnsRole,
      vpc,
      environment: lambdaEnvironment,
    });
    const usersLambdaIntegration = new apigateway.LambdaIntegration(
      usersLambda
    );

    const statsLambda = new lambda.Function(this, "ManageStats", {
      runtime: lambda.Runtime.NODEJS_14_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset("./lambdas/stats"),
      timeout: cdk.Duration.seconds(5),
      role: lambdaVpcRole,
      vpc,
      environment: lambdaEnvironment,
    });
    const statsLambdaIntegration = new apigateway.LambdaIntegration(
      statsLambda
    );

    // API Gateway Setup and Lambda/Route Integrations
    const api = new apigateway.RestApi(this, "TackleboxApi", {
      endpointTypes: [apigateway.EndpointType.REGIONAL],
      deployOptions: { stageName: "v1" },
      defaultCorsPreflightOptions: { allowOrigins: ["*"] },
    });

    const key = api.addApiKey("ApiKey", {
      apiKeyName: "v1",
    });

    const plan = api.addUsagePlan("UsagePlan", {
      name: "v1",
      description: "Enforce API Key requirement",
      apiStages: [{ api, stage: api.deploymentStage }],
    });

    plan.addApiKey(key);

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
    service.addMethod("DELETE", servicesLambdaIntegration, {
      apiKeyRequired: true,
    });

    const stats = service.addResource("stats");
    stats.addMethod("GET", statsLambdaIntegration, {
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
    eventType.addMethod("PUT", eventTypesLambdaIntegration, {
      apiKeyRequired: true,
    });
    eventType.addMethod("DELETE", eventTypesLambdaIntegration, {
      apiKeyRequired: true,
    });

    const users = service.addResource("users");
    users.addMethod("GET", usersLambdaIntegration, { apiKeyRequired: true });
    users.addMethod("POST", usersLambdaIntegration, { apiKeyRequired: true });

    const user = users.addResource("{user_id}");
    user.addMethod("GET", usersLambdaIntegration, { apiKeyRequired: true });
    user.addMethod("DELETE", usersLambdaIntegration, { apiKeyRequired: true });

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
    subscription.addMethod("DELETE", subscriptionsLambdaIntegration, {
      apiKeyRequired: true,
    });

    const test = subscription.addResource("test");
    test.addMethod("POST", subscriptionsLambdaIntegration, {
      apiKeyRequired: true,
    });

    new cdk.CfnOutput(this, "apiUrl", {
      value: api.url,
      description: "The API host URL",
      exportName: "apiHost",
    });

    new cdk.CfnOutput(this, "apiKeyId", {
      value: key.keyId,
      description: "The API key ID",
      exportName: "apiKeyId",
    });

    new cdk.CfnOutput(this, "dbSetupLambda", {
      value: dbSetupLambda.functionArn,
      description: "ARN for DB Setup lambda",
      exportName: "dbSetupLambda",
    });
  }
}

module.exports = { TackleboxStack, IamStack };
