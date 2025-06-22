from flask import Flask, request, jsonify
from flask_cors import CORS
import json

app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

# Your verify token - should match what you set in Facebook
VERIFY_TOKEN = "my_verify_token"

@app.route('/')
def home():
    return """
    <h1>Facebook Webhook Server</h1>
    <p>Webhook endpoint: /webhook</p>
    <p>Status: Running ✅</p>
    """

@app.route('/webhook', methods=['GET', 'POST'])
def webhook():
    if request.method == 'GET':
        # Webhook verification from Facebook
        token = request.args.get('hub.verify_token')
        challenge = request.args.get('hub.challenge')
        
        print(f"Verification request - Token: {token}, Challenge: {challenge}")
        
        if token == VERIFY_TOKEN:
            print("Webhook verified successfully!")
            return challenge
        else:
            print("Verification failed - invalid token")
            return 'Invalid verification token', 403
    
    elif request.method == 'POST':
        # Handle incoming messages from Facebook
        try:
            data = request.get_json()
            print("Received webhook data:")
            print(json.dumps(data, indent=2))
            
            # Process the webhook data here
            if data and 'entry' in data:
                for entry in data['entry']:
                    if 'messaging' in entry:
                        for message_event in entry['messaging']:
                            print(f"Message from user: {message_event}")
                            # Handle the message here
            
            return jsonify({"status": "received"}), 200
            
        except Exception as e:
            print(f"Error processing webhook: {e}")
            return jsonify({"error": "Failed to process webhook"}), 500

@app.route('/api/connect-page', methods=['POST'])
def connect_page():
    """Handle page connection requests from frontend"""
    try:
        data = request.get_json()
        print(f"Page connection request: {data}")
        
        # Here you would normally:
        # 1. Subscribe to page webhooks using Facebook Graph API
        # 2. Store page access token
        # 3. Set up webhook subscriptions
        
        # For now, return success
        return jsonify({
            "status": "success",
            "message": "Page connected successfully"
        }), 200
        
    except Exception as e:
        print(f"Error connecting page: {e}")
        return jsonify({
            "status": "error", 
            "message": f"Failed to connect page: {str(e)}"
        }), 500

@app.route('/health')
def health():
    return jsonify({"status": "healthy", "message": "Server is running"})

if __name__ == '__main__':
    print("Starting Facebook Webhook Server...")
    print("Webhook URL will be: http://localhost:3002/webhook")
    print("Verify token:", VERIFY_TOKEN)
    app.run(host='0.0.0.0', port=3002, debug=True)