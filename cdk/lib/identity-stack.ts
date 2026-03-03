import { Stack, StackProps, Duration } from 'aws-cdk-lib'
import { Construct } from 'constructs'
import { UserPool, UserPoolClient, AccountRecovery, OAuthScope } from 'aws-cdk-lib/aws-cognito'

export interface IdentityProps extends StackProps {
  resourcePrefix: string
}

export class IdentityStack extends Stack {
  public readonly userPool: UserPool
  public readonly userPoolClient: UserPoolClient

  constructor(scope: Construct, id: string, props: IdentityProps) {
    super(scope, id, props)

    this.userPool = new UserPool(this, 'UserPool', {
      userPoolName: `${props.resourcePrefix}UserPool`,
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      accountRecovery: AccountRecovery.EMAIL_ONLY,
    })

    this.userPoolClient = this.userPool.addClient('WebClient', {
      userPoolClientName: `${props.resourcePrefix}WebClient`,
      authFlows: { userSrp: true },
      oAuth: { scopes: [OAuthScope.OPENID, OAuthScope.EMAIL, OAuthScope.PROFILE] },
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
    })
  }
}
