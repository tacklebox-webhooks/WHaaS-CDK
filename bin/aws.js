#!/usr/bin/env node

const cdk = require("@aws-cdk/core");
const { TackleboxStack, WebsiteStack } = require("../lib/aws-stack");

const app = new cdk.App();
new TackleboxStack(app, "Tacklebox");
