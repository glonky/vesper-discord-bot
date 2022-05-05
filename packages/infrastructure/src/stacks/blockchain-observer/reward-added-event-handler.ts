import path from 'node:path';
import { NodejsFunction, NodejsFunctionProps, SourceMapMode } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import { StartingPosition } from 'aws-cdk-lib/aws-lambda';
import { DynamoEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { BaseConfig } from '@vesper-discord/config';
import { Container } from 'typedi';
import { Duration } from 'aws-cdk-lib';
import { Database } from '../shared-resources/database';

export interface RewardAddedEventHandlerProps extends NodejsFunctionProps {
  database: Database;
}

export class RewardAddedEventHandler extends NodejsFunction {
  constructor(scope: Construct, id: string, props: RewardAddedEventHandlerProps) {
    const envVars = Container.get(BaseConfig).loadDotEnvFilesForAwsDeploy();

    super(scope, id, {
      bundling: {
        sourceMap: true,
        sourceMapMode: SourceMapMode.BOTH,
      },
      entry: path.join(__dirname, `./functions/reward-added-event-handler/index.ts`),
      environment: {
        ...envVars,
        AWS_RESOURCE_VESPER_SINGLE_TABLE: props.database.vesperSingleTable.table.tableName,
      },
      memorySize: 256,
      timeout: Duration.minutes(5),
      ...props,
    });

    props.database.vesperSingleTable.table.grantReadWriteData(this);

    this.addEventSource(
      new DynamoEventSource(props.database.vesperSingleTable.table, {
        startingPosition: StartingPosition.LATEST,
      }),
    );
  }
}
