import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class PersonyzeApi implements ICredentialType {
	name = 'personyzeApi';

	displayName = 'Personyze API';

	icon = { light: 'file:personyze.svg', dark: 'file:personyze.dark.svg' } as const;

	documentationUrl = 'https://personyze.com/wiki/rest:api-key';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'Generate one in Personyze under Account settings → Integrations. Keys are shared with the Full-featured API, Zapier and Make cards, so a key from any of them works here.',
		},
	];

	// Personyze authenticates with HTTP Basic where the user name is always the
	// literal string `api` and the password is the key. There is no second field
	// to collect: asking for a user name would invite people to type their own.
	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			auth: {
				username: 'api',
				password: '={{ $credentials.apiKey }}',
			},
		},
	};

	// Reads nothing and changes nothing, and answers 401 for a key that is wrong,
	// revoked, or sent over plain HTTP -- the three ways a key can be bad.
	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://app.personyze.com/rest',
			url: '/account',
		},
	};
}
