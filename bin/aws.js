#!/usr/bin/env node

const cdk = require("@aws-cdk/core");
const { TackleboxStack, IamStack } = require("../lib/aws-stack");

const app = new cdk.App();
new IamStack(app, "tacklebox-iam");

const props = {
  lambdaVpcRoleArn: cdk.Fn.importValue("lambdaVpcRole"),
  lambdaVpcSnsRoleArn: cdk.Fn.importValue("lambdaVpcSnsRole"),
  lambdaVpcSnsLogsRoleArn: cdk.Fn.importValue("lambdaVpcSnsLogsRole"),
};

new TackleboxStack(app, "Tacklebox", props);
