import type {
	IExecuteSingleFunctions,
	IHttpRequestOptions,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

/**
 * Personyze puts `where`, `order_by` and `limit` in the URL PATH, not the query
 * string, so every user value spliced into a URL is encoded here rather than
 * left to the HTTP layer -- an unencoded `&` or `/` in an email would otherwise
 * change what the condition means.
 */
const ENCODE = 'encodeURIComponent';

/**
 * Profiles have no fixed schema: any key you send is stored. The standard fields
 * are their own inputs, and this folds the free-form ones in beside them.
 *
 * Empty values are dropped by Personyze on write (`insertWithoutEmpty`), so an
 * unmapped field never blanks a stored one.
 */
async function sendCustomFields(
	this: IExecuteSingleFunctions,
	requestOptions: IHttpRequestOptions,
): Promise<IHttpRequestOptions> {
	const custom = this.getNodeParameter('customFields.field', []) as Array<{
		name: string;
		value: string;
	}>;
	const body = (requestOptions.body ?? {}) as Record<string, unknown>;
	for (const { name, value } of custom) {
		if (name) body[name] = value;
	}
	requestOptions.body = body;
	return requestOptions;
}

/**
 * Only these two. `internal_id` is stored on a profile and read back, but it is
 * NOT a working lookup key on this object -- verified against a live account:
 * `where/internal_id=…` matches nothing, and a second write carrying the same
 * one creates a duplicate instead of merging. Offering it would build the
 * duplicate-on-every-run bug straight into the node.
 */
const KEY_TYPE_OPTIONS = [
	{ name: 'Email', value: 'email' },
	{ name: 'Visitor ID', value: 'user_id' },
];

export class Personyze implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Personyze',
		name: 'personyze',
		icon: { light: 'file:personyze.svg', dark: 'file:personyze.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{ $parameter["operation"] + ": " + $parameter["resource"] }}',
		description: 'Create and update visitors, manage audiences and read events in Personyze',
		defaults: { name: 'Personyze' },
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'personyzeApi', required: true }],
		requestDefaults: {
			baseURL: 'https://app.personyze.com/rest',
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json',
			},
		},
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Audience', value: 'audience' },
					{ name: 'Event', value: 'event' },
					{ name: 'Visitor', value: 'visitor' },
				],
				default: 'visitor',
			},

			/* ------------------------------- visitor ------------------------------- */
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['visitor'] } },
				options: [
					{
						name: 'Create or Update',
						value: 'upsert',
						action: 'Create or update a visitor',
						description: 'Create a new record, or update the current one if it already exists (upsert)',
						routing: {
							request: { method: 'POST', url: '/users' },
							output: { postReceive: [{ type: 'setKeyValue', properties: { user_id: '={{ $response.body }}' } }] },
						},
					},
					{
						name: 'Delete',
						value: 'delete',
						action: 'Delete a visitor',
						description: 'Permanently delete a visitor. There is no way back.',
						routing: {
							request: {
								method: 'DELETE',
								url: `=/users/where/{{ $parameter["keyType"] }}={{ ${ENCODE}($parameter["keyValue"]) }}`,
							},
							output: { postReceive: [{ type: 'setKeyValue', properties: { rows_affected: '={{ $response.body }}' } }] },
						},
					},
					{
						name: 'Get Many',
						value: 'getAll',
						action: 'Get many visitors',
						description: 'Retrieve visitors, optionally filtered by an identifier',
						routing: {
							request: { method: 'GET' },
						},
					},
					{
						name: 'Update',
						value: 'update',
						action: 'Update a visitor',
						description: 'Update the fields of an existing visitor',
						routing: {
							request: {
								method: 'PUT',
								url: `=/users/where/{{ $parameter["keyType"] }}={{ ${ENCODE}($parameter["keyValue"]) }}`,
							},
							output: { postReceive: [{ type: 'setKeyValue', properties: { rows_affected: '={{ $response.body }}' } }] },
						},
					},
				],
				default: 'upsert',
			},
			{
				displayName: 'Find Visitor By',
				name: 'keyType',
				type: 'options',
				options: KEY_TYPE_OPTIONS,
				default: 'email',
				required: true,
				description:
					'Email and the Personyze visitor ID are the identifiers that resolve. Internal ID is stored but cannot be searched on.',
				displayOptions: { show: { resource: ['visitor'], operation: ['update', 'delete'] } },
			},
			{
				displayName: 'Value',
				name: 'keyValue',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { resource: ['visitor'], operation: ['update', 'delete'] } },
			},
			{
				displayName: 'Filter By',
				name: 'filterType',
				type: 'options',
				options: [{ name: 'None (All Visitors)', value: '' }, ...KEY_TYPE_OPTIONS],
				default: '',
				displayOptions: { show: { resource: ['visitor'], operation: ['getAll'] } },
			},
			{
				displayName: 'Value',
				name: 'filterValue',
				type: 'string',
				default: '',
				displayOptions: {
					show: { resource: ['visitor'], operation: ['getAll'] },
					hide: { filterType: [''] },
				},
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				typeOptions: { minValue: 1 },
				default: 50,
				description: 'Max number of results to return',
				displayOptions: { show: { resource: ['visitor'], operation: ['getAll'] } },
				routing: {
					request: {
						url: `=/users{{ $parameter["filterType"] ? "/where/" + $parameter["filterType"] + "=" + ${ENCODE}($parameter["filterValue"]) : "" }}/order_by/user_id/limit/0,{{ Math.min($value, 1000) }}`,
					},
				},
			},

			/* visitor fields, shared by Create or Update and Update */
			{
				displayName: 'Email',
				name: 'email',
				type: 'string',
				placeholder: 'name@email.com',
				default: '',
				displayOptions: { show: { resource: ['visitor'], operation: ['upsert', 'update'] } },
				routing: { send: { type: 'body', property: 'email' } },
			},
			{
				displayName: 'Internal ID',
				name: 'internalId',
				type: 'string',
				default: '',
				description:
					'Your own identifier, stored on the profile for reference. It is not a lookup key, so key your sync on Email.',
				displayOptions: { show: { resource: ['visitor'], operation: ['upsert', 'update'] } },
				routing: { send: { type: 'body', property: 'internal_id' } },
			},
			{
				displayName: 'First Name',
				name: 'firstName',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['visitor'], operation: ['upsert', 'update'] } },
				routing: { send: { type: 'body', property: 'first_name' } },
			},
			{
				displayName: 'Last Name',
				name: 'lastName',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['visitor'], operation: ['upsert', 'update'] } },
				routing: { send: { type: 'body', property: 'last_name' } },
			},
			{
				displayName: 'Phone',
				name: 'phone',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['visitor'], operation: ['upsert', 'update'] } },
				routing: { send: { type: 'body', property: 'phone' } },
			},
			{
				displayName: 'Custom Fields',
				name: 'customFields',
				type: 'fixedCollection',
				typeOptions: { multipleValues: true },
				placeholder: 'Add Field',
				default: {},
				description: 'Any other field on the profile. Profiles have no fixed schema.',
				displayOptions: { show: { resource: ['visitor'], operation: ['upsert', 'update'] } },
				options: [
					{
						displayName: 'Field',
						name: 'field',
						values: [
							{ displayName: 'Name', name: 'name', type: 'string', default: '' },
							{ displayName: 'Value', name: 'value', type: 'string', default: '' },
						],
					},
				],
				routing: { send: { preSend: [sendCustomFields] } },
			},

			/* ------------------------------- audience ------------------------------ */
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['audience'] } },
				options: [
					{
						name: 'Add Visitor',
						value: 'addVisitor',
						action: 'Add a visitor to an audience',
						description: 'Add an existing visitor to one of your audiences',
						routing: {
							request: { method: 'POST', url: '/user_list_users' },
							output: { postReceive: [{ type: 'setKeyValue', properties: { id: '={{ $response.body }}' } }] },
						},
					},
					{
						name: 'Get Many',
						value: 'getAll',
						action: 'Get many audiences',
						description: 'Retrieve the audiences defined on your account',
						routing: {
							request: { method: 'GET', url: '/user_lists' },
						},
					},
				],
				default: 'getAll',
			},
			{
				displayName: 'Audience ID',
				name: 'userListId',
				type: 'number',
				default: 0,
				required: true,
				displayOptions: { show: { resource: ['audience'], operation: ['addVisitor'] } },
				routing: { send: { type: 'body', property: 'user_list_id' } },
			},
			{
				displayName: 'Find Visitor By',
				name: 'memberKeyType',
				type: 'options',
				// The endpoint answers "User not found by ..." when nothing matches, so
				// the profile has to exist first. `user_internal_id` is deliberately
				// absent: it resolves through the same broken path as `internal_id`
				// and fails even when a profile carrying that id already exists.
				options: [
					{ name: 'Email', value: 'user_email' },
					{ name: 'Visitor ID', value: 'user_id' },
				],
				default: 'user_email',
				required: true,
				displayOptions: { show: { resource: ['audience'], operation: ['addVisitor'] } },
			},
			{
				displayName: 'Value',
				name: 'memberKeyValue',
				type: 'string',
				default: '',
				required: true,
				description: 'The visitor must already exist in Personyze',
				displayOptions: { show: { resource: ['audience'], operation: ['addVisitor'] } },
				routing: {
					send: { type: 'body', property: '={{ $parameter["memberKeyType"] }}' },
				},
			},

			/* -------------------------------- event -------------------------------- */
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['event'] } },
				options: [
					{
						name: 'Get Many',
						value: 'getAll',
						action: 'Get many events',
						description: 'Retrieve the events tracked for one visitor',
						routing: {
							request: { method: 'GET' },
						},
					},
				],
				default: 'getAll',
			},
			{
				displayName: 'Visitor ID',
				name: 'eventUserId',
				type: 'number',
				default: 0,
				description:
					'Restrict to one visitor. This column is not indexed on the events table, so the API serves it in pages of 50 at most.',
				displayOptions: { show: { resource: ['event'], operation: ['getAll'] } },
			},
			{
				displayName: 'Event ID',
				name: 'containerId',
				type: 'number',
				default: 0,
				description:
					'Restrict to one configured event type. Event containers are defined in the Personyze panel. Leave at 0 for all.',
				displayOptions: { show: { resource: ['event'], operation: ['getAll'] } },
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				typeOptions: { minValue: 1 },
				default: 50,
				description: 'Max number of results to return',
				displayOptions: { show: { resource: ['event'], operation: ['getAll'] } },
				routing: {
					request: {
						url: `=/events{{ $parameter["eventUserId"] || $parameter["containerId"] ? "/where/" : "" }}{{ $parameter["eventUserId"] ? "user_id=" + $parameter["eventUserId"] : "" }}{{ $parameter["eventUserId"] && $parameter["containerId"] ? "&" : "" }}{{ $parameter["containerId"] ? "container_id=" + $parameter["containerId"] : "" }}/order_by/id/limit/0,{{ Math.min($value, 50) }}`,
					},
				},
			},
		],
	};
}
