# Step 2: Install Dependencies
echo "Installing dependencies..."

# Check for Node.js installation
if ! command -v node &> /dev/null
then
    echo "Node.js not found. Installing Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_14.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

# Install npm packages
npm install

# Install Azurite globally if not already installed
if ! command -v azurite &> /dev/null
then
    echo "Azurite not found. Installing Azurite..."
    npm install -g azurite
fi

echo "Dependencies installed successfully."

# Step 3: Start Azurite (Azure Emulator)
echo "Starting Azurite..."
azurite -s &
sleep 5  # Allow time for Azurite to start

cd api

# Step 4: Create and configure .env file
echo "Creating .env file..."

if [ ! -f ".env" ]; then
    cat <<EOL > .env
# Mandatory variables
EMULATED=true
PORT=3010
EOL
    echo ".env file created and configured."
else
    echo ".env file already exists."
fi


# Install npm packages
npm install

# Step 5: Build the CodePush Server
echo "Building the CodePush Server..."
npm run build

# Step 6: HTTPS Setup (Optional)
if [ -d "certs" ] && [ -f "certs/cert.key" ] && [ -f "certs/cert.crt" ]; then
    echo "Certificates found, enabling HTTPS..."
    export HTTPS=true
else
    echo "No certificates found, running on HTTP..."
fi

# Step 7: Start the CodePush Server
echo "Starting CodePush Server..."
npm run start:env

echo "CodePush Server started successfully."
