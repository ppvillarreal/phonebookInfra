#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { PhonebookInfraStack } from '../lib/phonebook_infra-stack';

const app = new cdk.App();
new PhonebookInfraStack(app, 'PhonebookInfraStack', {
 
  env: { account: '656805403368', region: 'us-west-2' },

});