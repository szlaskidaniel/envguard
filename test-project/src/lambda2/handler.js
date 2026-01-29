
const OKTA_KEY = process.env.OKTA_CLIENT_ID;


module.exports.getPermissions = async (event) => {
    return {
        statusCode: 200,
        body: JSON.stringify({ message: `Your OKTA_CLIENT_ID is ${OKTA_KEY}` }),
    };

};