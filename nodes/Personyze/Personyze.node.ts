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
 * `/rest/do` takes a list of commands, each itself a list -- not the object
 * declarative routing builds. The shape is
 * `[[key, value, "Product Purchased", itemId]]`, with an optional trailing
 * `"quantity", n` pair that the dispatcher reads positionally.
 */
async function sendInteraction(
	this: IExecuteSingleFunctions,
	requestOptions: IHttpRequestOptions,
): Promise<IHttpRequestOptions> {
	const keyType = this.getNodeParameter('interactionKeyType') as string;
	const keyValue = this.getNodeParameter('interactionKeyValue') as string;
	const interaction = this.getNodeParameter('interaction') as string;
	const itemId = this.getNodeParameter('itemInternalId') as string;
	const quantity = this.getNodeParameter('quantity', 0) as number;

	const command: Array<string | number> = [keyType, keyValue, interaction, itemId];
	if (interaction.startsWith('Product') && quantity > 0) {
		command.push('quantity', quantity);
	}

	requestOptions.body = [command];
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
		description: 'Create and update visitors, manage audiences and the product catalog, record interactions, and read events in Personyze',
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
					{ name: 'Interaction', value: 'interaction' },
					{ name: 'Product', value: 'product' },
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
						name: 'Create',
						value: 'create',
						action: 'Create an audience',
						// Audience names are NOT unique -- posting the same name twice
						// returns two different ids. A workflow that creates on every run
						// therefore accumulates duplicates until targeting stops making
						// sense, so the description says to look first.
						description:
							'Create an audience. Names are not unique, so check with Get Many before creating one per run.',
						routing: {
							request: { method: 'POST', url: '/user_lists' },
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
				displayName: 'Name',
				name: 'audienceName',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { resource: ['audience'], operation: ['create'] } },
				routing: { send: { type: 'body', property: 'name' } },
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
				// the profile has to exist first.
				//
				// `user_internal_id` used to be left out here, on the grounds that it
				// resolved through the same broken path as `internal_id` and failed
				// even for a profile carrying that id. Re-tested against a live
				// account, that is not so: two profiles were written, one with
				// `internal_text_id` and one with `internal_id`, and BOTH were found
				// and added by `user_internal_id`. The membership rows were read back
				// to confirm it, because this endpoint answers every call with a
				// meaningless lastInsertId and cannot be trusted to report success.
				options: [
					{ name: 'Email', value: 'user_email' },
					{ name: 'CRM ID', value: 'user_internal_id' },
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

			/* ------------------------------- product ------------------------------- */
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['product'] } },
				options: [
					{
						name: 'Create or Update',
						value: 'upsert',
						action: 'Create or update a product',
						// `internal_id` carries a UNIQUE index and the endpoint inserts in
						// patch mode, so this really does update in place AND leaves unsent
						// fields alone. That is what makes a partial sync safe: a workflow
						// that only knows price and stock can run against products whose
						// descriptions came from somewhere else.
						description: 'Create a new record, or update the current one if it already exists (upsert)',
						routing: {
							request: { method: 'POST', url: '/products' },
							output: { postReceive: [{ type: 'setKeyValue', properties: { id: '={{ $response.body }}' } }] },
						},
					},
					{
						name: 'Delete',
						value: 'delete',
						action: 'Delete a product',
						description: 'Permanently delete a product from the catalog',
						routing: {
							request: {
								method: 'DELETE',
								url: `=/products/where/internal_id={{ ${ENCODE}($parameter["productInternalId"]) }}`,
							},
							output: { postReceive: [{ type: 'setKeyValue', properties: { rows_affected: '={{ $response.body }}' } }] },
						},
					},
				],
				default: 'upsert',
			},
			{
				displayName: 'Product ID',
				name: 'productInternalId',
				type: 'string',
				default: '',
				required: true,
				description:
					'Your own identifier for the product. Sending the same ID again updates that product rather than adding a second one.',
				displayOptions: { show: { resource: ['product'] } },
				routing: { send: { type: 'body', property: 'internal_id' } },
			},
			{
				displayName: 'Title',
				name: 'productTitle',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['product'], operation: ['upsert'] } },
				routing: { send: { type: 'body', property: 'title' } },
			},
			{
				displayName: 'Price',
				name: 'productPrice',
				type: 'number',
				default: 0,
				displayOptions: { show: { resource: ['product'], operation: ['upsert'] } },
				routing: { send: { type: 'body', property: 'price' } },
			},
			{
				displayName: 'Sale Price',
				name: 'productSalePrice',
				type: 'number',
				default: 0,
				displayOptions: { show: { resource: ['product'], operation: ['upsert'] } },
				routing: { send: { type: 'body', property: 'sale_price' } },
			},
			{
				displayName: 'In Stock',
				name: 'productInStock',
				type: 'options',
				options: [
					{ name: 'Yes', value: 'yes' },
					{ name: 'No', value: 'no' },
				],
				default: 'yes',
				description: 'Whether the product is in stock. Out-of-stock products can be held back from recommendations.',
				displayOptions: { show: { resource: ['product'], operation: ['upsert'] } },
				routing: { send: { type: 'body', property: 'is_in_stock' } },
			},
			{
				displayName: 'Product Page URL',
				name: 'productGuideUrl',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['product'], operation: ['upsert'] } },
				routing: { send: { type: 'body', property: 'guide_url' } },
			},
			{
				displayName: 'Image URL',
				name: 'productImageUrl',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['product'], operation: ['upsert'] } },
				routing: { send: { type: 'body', property: 'image_big_url' } },
			},
			{
				displayName: 'Other Fields',
				name: 'customFields',
				type: 'fixedCollection',
				typeOptions: { multipleValues: true },
				placeholder: 'Add Field',
				default: {},
				description:
					'Any other product field, such as SKU, brand, manufacturer, size, color, inventory, or custom_1 through custom_10',
				displayOptions: { show: { resource: ['product'], operation: ['upsert'] } },
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

			/* ----------------------------- interaction ----------------------------- */
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['interaction'] } },
				options: [
					{
						name: 'Record',
						value: 'record',
						action: 'Record an interaction',
						description:
							'Record that a visitor viewed, liked, carted or purchased something, so activity from a shop, POS or CRM counts toward recommendations and targeting',
						routing: {
							request: { method: 'POST', url: '/do' },
							send: { preSend: [sendInteraction] },
							output: { postReceive: [{ type: 'setKeyValue', properties: { recorded: '={{ true }}' } }] },
						},
					},
				],
				default: 'record',
			},
			{
				displayName: 'Find Visitor By',
				name: 'interactionKeyType',
				type: 'options',
				options: [
					{ name: 'Email', value: 'email' },
					{ name: 'CRM ID', value: 'internal_id' },
					{ name: 'Visitor ID', value: 'user_id' },
				],
				default: 'email',
				required: true,
				displayOptions: { show: { resource: ['interaction'] } },
			},
			{
				displayName: 'Value',
				name: 'interactionKeyValue',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { resource: ['interaction'] } },
			},
			{
				displayName: 'Interaction',
				name: 'interaction',
				type: 'options',
				// One list of the exact command strings the dispatcher understands,
				// rather than an item-type field plus an action field. Two fields would
				// let someone pick "Article" with "Added to Cart", which is not a thing.
				options: [
					{ name: 'Article Commented', value: 'Article Commented' },
					{ name: 'Article Goal', value: 'Article Goal' },
					{ name: 'Article Liked', value: 'Article Liked' },
					{ name: 'Article Unliked', value: 'Article Unliked' },
					{ name: 'Article Viewed', value: 'Article Viewed' },
					{ name: 'Product Added to Cart', value: 'Product Added to cart' },
					{ name: 'Product Liked', value: 'Product Liked' },
					{ name: 'Product Purchased', value: 'Product Purchased' },
					{ name: 'Product Removed From Cart', value: 'Product Removed from cart' },
					{ name: 'Product Unliked', value: 'Product Unliked' },
					{ name: 'Product Viewed', value: 'Product Viewed' },
				],
				default: 'Product Purchased',
				required: true,
				displayOptions: { show: { resource: ['interaction'] } },
			},
			{
				displayName: 'Product or Article ID',
				name: 'itemInternalId',
				type: 'string',
				default: '',
				required: true,
				description:
					'The item ID in your Personyze catalog. It must already exist -- recording against an unknown ID fails.',
				displayOptions: { show: { resource: ['interaction'] } },
			},
			{
				displayName: 'Quantity',
				name: 'quantity',
				type: 'number',
				default: 0,
				description: 'Products only, and optional. Leave at 0 to send none, which Personyze reads as 1.',
				displayOptions: { show: { resource: ['interaction'] } },
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
