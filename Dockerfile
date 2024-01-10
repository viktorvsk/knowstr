# Use the official Node.js image from Docker Hub
FROM node:21.5.0-alpine3.19

# Set the working directory inside the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json (if present) to the working directory
COPY package*.json ./

# Install application dependencies
RUN npm install

# Copy the rest of the application code to the working directory
COPY . .
