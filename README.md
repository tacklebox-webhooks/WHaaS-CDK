# Deploy our WHaaS to AWS using AWS Cloud Development Kit

These are the steps that you'll probably need to run in order to deploy the infrastructure to your AWS account. Most of steps simply installs the depencies needed and could be simplified by using an `npm` script. I'm keeping it like this for now so that we can easily troubleshoot as needed.

## Deployment guidelines

### Prerequisites

- an AWS account
- AWS CLI installed and configured on your local machine
- npm installed on your local machine
- Whole deployment should take about 15-20 minutes.

If you run into difficulties, you might have to run the following commands:

- `npm install -g aws-cdk`: this install the CLI for using the Cloud Development Kit globally on your system.
- `cdk bootstrap`: this might be needed to bundle up the lambda with its dependencies. You can run the command from the root directory if needed (you'll be instructed to do so if there's an issue).


## Useful commands

- `npm run test` perform the jest unit tests
- `cdk deploy` deploy this stack to your default AWS account/region
- `cdk diff` compare deployed stack with current state
- `cdk synth` emits the synthesized CloudFormation template
