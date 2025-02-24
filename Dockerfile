FROM node: 18-alpine

# Set the working directory in the container
WORKDIR /app

# Copy package.json and package-lock.json to the working directory
COPY api/package*.json ./

RUN npm install

COPY . .

EXPOSE 3000


# Command to run the application
CMD ["npm", "start"]
