#!/bin/bash

# Test script for React UI migration
echo "🚀 Testing React UI Migration..."

# Check if React UI directory exists
if [ ! -d "ui-react" ]; then
    echo "❌ React UI directory not found"
    exit 1
fi

echo "✅ React UI directory exists"

# Check if package.json exists and has required dependencies
if [ ! -f "ui-react/package.json" ]; then
    echo "❌ package.json not found"
    exit 1
fi

echo "✅ package.json found"

# Check for key React files
required_files=(
    "ui-react/src/App.jsx"
    "ui-react/src/main.jsx"
    "ui-react/src/index.css"
    "ui-react/src/components/Header.jsx"
    "ui-react/src/components/JobsTab.jsx"
    "ui-react/src/components/AgentsTab.jsx"
    "ui-react/src/hooks/useData.js"
    "ui-react/src/utils/api.js"
    "ui-react/Dockerfile"
    "ui-react/vite.config.js"
)

for file in "${required_files[@]}"; do
    if [ ! -f "$file" ]; then
        echo "❌ Missing file: $file"
        exit 1
    fi
done

echo "✅ All required React files present"

# Check if docker-compose.yml includes React UI service
if ! grep -q "router-ui-react" docker-compose.yml; then
    echo "❌ React UI service not found in docker-compose.yml"
    exit 1
fi

echo "✅ React UI service configured in docker-compose.yml"

# Check if we can build the React app (requires Node.js)
if command -v node >/dev/null 2>&1; then
    echo "📦 Node.js found, testing build..."
    cd ui-react
    
    if command -v npm >/dev/null 2>&1; then
        echo "🔧 Installing dependencies..."
        npm install --silent
        
        echo "🏗️ Testing build..."
        npm run build
        
        if [ $? -eq 0 ]; then
            echo "✅ React app builds successfully"
        else
            echo "❌ React app build failed"
            cd ..
            exit 1
        fi
    else
        echo "⚠️ npm not found, skipping build test"
    fi
    
    cd ..
else
    echo "⚠️ Node.js not found, skipping build test"
fi

# Test Docker build if Docker is available
if command -v docker >/dev/null 2>&1; then
    echo "🐳 Docker found, testing container build..."
    cd ui-react
    
    if docker build -t agentic-ui-react-test . >/dev/null 2>&1; then
        echo "✅ Docker image builds successfully"
        # Clean up test image
        docker rmi agentic-ui-react-test >/dev/null 2>&1
    else
        echo "❌ Docker image build failed"
        cd ..
        exit 1
    fi
    
    cd ..
else
    echo "⚠️ Docker not found, skipping container build test"
fi

echo ""
echo "🎉 React UI Migration Test Summary:"
echo "✅ File structure complete"
echo "✅ Configuration files present" 
echo "✅ Docker configuration ready"
echo "✅ React app builds (if Node.js available)"
echo "✅ Docker image builds (if Docker available)"
echo ""
echo "🚀 Next steps:"
echo "1. Run: docker-compose up router-ui-react"
echo "2. Open: http://localhost:8090"
echo "3. Compare with legacy UI: http://localhost:8091"
echo ""
echo "📖 See ui-react/README.md for detailed development instructions"