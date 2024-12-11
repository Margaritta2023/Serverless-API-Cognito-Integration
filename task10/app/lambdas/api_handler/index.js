const AWS = require('aws-sdk');
const { v4: uuidv4 } = require('uuid');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
    DynamoDBDocumentClient,
    PutCommand,
} = require("@aws-sdk/lib-dynamodb");

const cognitoService = new AWS.CognitoIdentityServiceProvider({
    region: process.env.region
});

const dbClient = new DynamoDBClient({ region: 'eu-central-1' });
const docClient = DynamoDBDocumentClient.from(dbClient);

const dynamoDbClient = new AWS.DynamoDB.DocumentClient();
const reservationsTableName = 'cmtr-c489fdd3-Reservations-test';
const tablesTableName = process.env.TABLE;

exports.handler = async (event) => {
    const userPoolId = process.env.USERPOOL;
    const clientId = process.env.USERPOOLCLIENT;
    let requestBody = JSON.parse(event.body);

    if (event.resource === '/signup' && event.httpMethod === 'POST') {
        const { email, password, firstName, lastName } = requestBody;
        const signUpParams = {
            ClientId: clientId,
            Username: email,
            Password: password,
            UserAttributes: [{ Name: 'email', Value: email }],
        };

        try {
            const signUpData = await cognitoService.signUp(signUpParams).promise();
            const confirmParams = {
                Username: email,
                UserPoolId: userPoolId
            };
            await cognitoService.adminConfirmSignUp(confirmParams).promise();

            return {
                statusCode: 200,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ message: "User created successfully" })
            };
        } catch (error) {
            return {
                statusCode: 400,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ error: "Signup failed", details: error.message })
            };
        }
    }

    if (event.resource === '/signin' && event.httpMethod === 'POST') {
        const { email, password } = requestBody;
        const authParams = {
            AuthFlow: 'ADMIN_NO_SRP_AUTH',
            UserPoolId: userPoolId,
            ClientId: clientId,
            AuthParameters: {
                USERNAME: email,
                PASSWORD: password
            }
        };

        try {
            const authData = await cognitoService.adminInitiateAuth(authParams).promise();
            return {
                statusCode: 200,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    accessToken: authData.AuthenticationResult.IdToken || 'blank'
                })
            };
        } catch (error) {
            return {
                statusCode: 400,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ error: "Authentication failed", details: error })
            };
        }
    }

    if (event.resource === '/tables' && event.httpMethod === 'GET') {
        const fetchTablesParams = {
            TableName: tablesTableName
        };
        try {
            const tableData = await dynamoDbClient.scan(fetchTablesParams).promise();
            return {
                statusCode: 200,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ tables: tableData.Items })
            };
        } catch (error) {
            return {
                statusCode: 500,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ error: "Failed to fetch tables", details: error.message })
            };
        }
    }

    if (event.resource === '/tables' && event.httpMethod === 'POST') {
        try {
            const putTableParams = {
                TableName: tablesTableName,
                Item: requestBody
            };
            await dynamoDbClient.put(putTableParams).promise();
            return {
                statusCode: 200,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: requestBody.id })
            };
        } catch (error) {
            return {
                statusCode: 500,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ message: "error" })
            };
        }
    }

    if (event.resource === '/tables/{tableId}' && event.httpMethod === 'GET') {
        const tableId = event.pathParameters.tableId;
        const fetchTableParams = {
            TableName: tablesTableName,
            Key: { id: parseInt(tableId) }
        };
        try {
            const tableData = await dynamoDbClient.get(fetchTableParams).promise();
            if (tableData.Item) {
                return {
                    statusCode: 200,
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ ...tableData.Item })
                };
            } else {
                return {
                    statusCode: 404,
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ error: "Table not found" })
                };
            }
        } catch (error) {
            return {
                statusCode: 500,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ error: "Failed to fetch table data", details: error.message })
            };
        }
    }

    if (event.resource === '/reservations' && event.httpMethod === 'GET') {
        try {
            const fetchReservationsParams = { TableName: reservationsTableName };
            const reservationsData = await dynamoDbClient.scan(fetchReservationsParams).promise();
            return {
                statusCode: 200,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ reservations: reservationsData.Items })
            };
        } catch (error) {
            return {
                statusCode: 500,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ message: error.message })
            };
        }
    }

    async function doesTableExist(tableNumber) {
        const parsedTableNumber = parseInt(tableNumber);
        try {
            const tableCheckResponse = await dynamoDbClient
                .scan({
                    TableName: "cmtr-c489fdd3-Tables-test",
                    FilterExpression: "#num = :tableNum",
                    ExpressionAttributeNames: {
                        "#num": "number",
                    },
                    ExpressionAttributeValues: {
                        ":tableNum": parsedTableNumber
                    },
                })
                .promise();
            return tableCheckResponse.Items.length > 0;
        } catch (error) {
            return false;
        }
    }

    async function isReservationConflict(reservationDetails) {
        try {
            const tableNumber = reservationDetails.tableNumber;
            const reservationsConflictResponse = await dynamoDbClient
                .scan({
                    TableName: "cmtr-c489fdd3-Reservations-test",
                    ExpressionAttributeValues: {
                        ":tableNum": parseInt(tableNumber)
                    },
                    FilterExpression: "tableNumber = :tableNum",
                })
                .promise();
            for (const reservation of reservationsConflictResponse.Items) {
                const existingStartTime = new Date(`${reservation.date} ${reservation.slotTimeStart}`).getTime();
                const existingEndTime = new Date(`${reservation.date} ${reservation.slotTimeEnd}`).getTime();
                const newStartTime = new Date(`${reservationDetails.date} ${reservationDetails.slotTimeStart}`).getTime();
                const newEndTime = new Date(`${reservationDetails.date} ${reservationDetails.slotTimeEnd}`).getTime();

                if (newStartTime < existingEndTime && newEndTime > existingStartTime) {
                    return true;
                }
            }

            return false;
        } catch (error) {
            throw error;
        }
    }

    if (event.resource === '/reservations' && event.httpMethod === 'POST') {
        try {
            const isTableAvailable = await doesTableExist(requestBody.tableNumber);
            if (!isTableAvailable) {
                return {
                    statusCode: 400,
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ message: "table does not exist" })
                };
            }

            const isConflict = await isReservationConflict(requestBody);
            if (isConflict) {
                return {
                    statusCode: 400,
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ message: "Reservation overlaps with an existing one" })
                };
            }

            const reservationId = uuidv4();
            const putReservationParams = {
                TableName: reservationsTableName,
                Item: {
                    "id": reservationId,
                    "tableNumber": requestBody.tableNumber,
                    "clientName": requestBody.clientName,
                    "phoneNumber": requestBody.phoneNumber,
                    "date": requestBody.date,
                    "slotTimeStart": requestBody.slotTimeStart,
                    "slotTimeEnd": requestBody.slotTimeEnd
                }
            };
            await dynamoDbClient.put(putReservationParams).promise();
            return {
                statusCode: 200,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ reservationId })
            };
        } catch (error) {
            return {
                statusCode: 500,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ message: error.message })
            };
        }
    }

    return {
        statusCode: 404,
        body: JSON.stringify({ message: "Resource not found" })
    };
};
