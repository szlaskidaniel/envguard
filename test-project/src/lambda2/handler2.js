
const OKTA_KEY = process.env.OKTA_DEV_CLIENT_ID;

const client = new SecretsManagerClient({ region: process.env.AWS_REGION });


module.exports.getPermissions = async (event) => {
    return {
        statusCode: 200,
        body: JSON.stringify({ message: `Your OKTA_CLIENT_ID is ${OKTA_KEY}` }),
    };

};