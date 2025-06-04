#!/bin/bash

# End-to-End Vault Secrets Demo Testing Script
# This script automates the complete testing flow from build to validation

set -e  # Exit on any error

# Configuration
NAMESPACE="vault-live-secrets-demo"
DEPLOYMENT="vault-live-secrets-demo"
SECRET_NAME="vault-web-secrets"
APP_URL="https://vault-live-secrets-demo-vault-live-secrets-demo.apps.openshift-01.hashicorp.local"
TEST_VALUE="frozen$(date +%s)"  # Unique test value with timestamp
VAULT_PATH="secrets/dev"
VAULT_KEY="somethingnew"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_step() {
    echo -e "\n${BLUE}==== STEP: $1 ====${NC}"
}

# Function to check if a command exists
check_command() {
    if ! command -v $1 &> /dev/null; then
        log_error "Command '$1' not found. Please install it."
        exit 1
    fi
}

# Function to wait for deployment to be ready
wait_for_deployment() {
    local max_attempts=30
    local attempt=1
    
    log_info "Waiting for deployment to be ready (max ${max_attempts} attempts)..."
    
    while [ $attempt -le $max_attempts ]; do
        local ready_replicas=$(oc get deployment $DEPLOYMENT -n $NAMESPACE -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
        local desired_replicas=$(oc get deployment $DEPLOYMENT -n $NAMESPACE -o jsonpath='{.spec.replicas}' 2>/dev/null || echo "1")
        
        if [ "$ready_replicas" = "$desired_replicas" ] && [ "$ready_replicas" != "0" ]; then
            log_success "Deployment is ready! ($ready_replicas/$desired_replicas replicas)"
            return 0
        fi
        
        log_info "Attempt $attempt/$max_attempts: $ready_replicas/$desired_replicas replicas ready"
        sleep 10
        ((attempt++))
    done
    
    log_error "Deployment failed to become ready within timeout"
    return 1
}

# Function to wait for app to be accessible
wait_for_app() {
    local max_attempts=20
    local attempt=1
    
    log_info "Waiting for app to be accessible at $APP_URL"
    
    while [ $attempt -le $max_attempts ]; do
        if curl -s -f -k "$APP_URL/api/health" > /dev/null 2>&1; then
            log_success "App is accessible and responding"
            return 0
        fi
        
        log_info "Attempt $attempt/$max_attempts: App not yet accessible"
        sleep 5
        ((attempt++))
    done
    
    log_error "App failed to become accessible within timeout"
    return 1
}

# Function to get current secret values
get_k8s_secret_values() {
    kubectl get secret $SECRET_NAME -n $NAMESPACE -o jsonpath='{.data}' 2>/dev/null | jq -r 'to_entries[] | "\(.key): \(.value | @base64d)"' 2>/dev/null || echo "Error reading secret"
}

# Function to get app API values
get_app_api_values() {
    curl -s -k "$APP_URL/api/secrets" | jq -r '.secrets | to_entries[] | "\(.key): \(.value.content)"' 2>/dev/null || echo "Error reading API"
}

# Function to extract specific value from output
extract_value() {
    local output="$1"
    local key="$2"
    echo "$output" | grep "^$key:" | cut -d':' -f2- | xargs
}

# Function to get pod logs
get_pod_logs() {
    local pod_name=$(oc get pods -n $NAMESPACE -l app=$DEPLOYMENT -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)
    if [ -n "$pod_name" ]; then
        echo "Recent logs from pod $pod_name:"
        oc logs $pod_name -n $NAMESPACE --tail=50 | tail -20
    else
        echo "No pod found for deployment $DEPLOYMENT"
    fi
}

# Function to monitor for changes with timeout
monitor_for_changes() {
    local expected_value="$1"
    local max_wait=120  # 2 minutes
    local check_interval=5
    local elapsed=0
    
    log_info "Monitoring for value '$expected_value' to appear (max ${max_wait}s)..."
    
    # Get initial states
    local initial_k8s=$(get_k8s_secret_values)
    local initial_app=$(get_app_api_values)
    
    log_info "Initial K8s secret state:"
    echo "$initial_k8s" | head -5
    log_info "Initial App API state:"
    echo "$initial_app" | head -5
    
    while [ $elapsed -lt $max_wait ]; do
        # Check K8s secret
        local current_k8s=$(get_k8s_secret_values)
        local k8s_value=$(extract_value "$current_k8s" "$VAULT_KEY")
        
        # Check App API
        local current_app=$(get_app_api_values)
        local app_value=$(extract_value "$current_app" "$VAULT_KEY")
        
        log_info "Time: ${elapsed}s | K8s: '$k8s_value' | App: '$app_value'"
        
        # Check if both have the expected value
        if [ "$k8s_value" = "$expected_value" ] && [ "$app_value" = "$expected_value" ]; then
            log_success "SUCCESS! Both K8s and App show expected value '$expected_value' after ${elapsed}s"
            return 0
        elif [ "$k8s_value" = "$expected_value" ]; then
            log_warning "K8s has correct value but App API still shows: '$app_value'"
        elif [ "$app_value" = "$expected_value" ]; then
            log_warning "App API has correct value but K8s secret still shows: '$k8s_value'"
        fi
        
        sleep $check_interval
        ((elapsed += check_interval))
    done
    
    log_error "Timeout after ${max_wait}s. Final states:"
    echo "K8s Secret: $k8s_value"
    echo "App API: $app_value"
    return 1
}

# Main execution
main() {
    log_step "Pre-flight Checks"
    
    # Check required commands
    for cmd in oc kubectl vault curl jq docker; do
        check_command $cmd
    done
    
    # Check if we're logged into OpenShift
    if ! oc whoami &> /dev/null; then
        log_error "Not logged into OpenShift. Please run 'oc login' first."
        exit 1
    fi
    
    # Check if vault is configured
    if ! vault status &> /dev/null; then
        log_error "Vault CLI not configured or server unreachable. Please configure vault."
        exit 1
    fi
    
    log_success "All pre-flight checks passed"
    
    # Step 1: Build new image
    log_step "Building New Docker Image"
    cd /Users/aarone/Documents/repos/vault-react-demo-app
    
    if [ -f "scripts/build.sh" ]; then
        log_info "Using existing build script..."
        bash scripts/build.sh
    else
        log_info "Building image manually..."
        docker build -t quay.io/aaroneautomate/vault-secrets-web-demo:latest -f docker/Dockerfile .
        docker push quay.io/aaroneautomate/vault-secrets-web-demo:latest
    fi
    
    log_success "Image build completed"
    
    # Step 2: Restart deployment
    log_step "Restarting Deployment"
    oc rollout restart deployment/$DEPLOYMENT -n $NAMESPACE
    log_success "Deployment restart initiated"
    
    # Step 3: Wait for deployment to be ready
    log_step "Waiting for Deployment Ready State"
    wait_for_deployment
    
    # Step 4: Wait for app to be accessible
    log_step "Waiting for App Accessibility"
    wait_for_app
    
    # Get baseline state
    log_step "Getting Baseline State"
    log_info "Current K8s secret values:"
    get_k8s_secret_values | head -5
    log_info "Current App API values:"
    get_app_api_values | head -5
    
    # Step 5: Update Vault secret
    log_step "Updating Vault Secret"
    log_info "Setting $VAULT_KEY to '$TEST_VALUE' in $VAULT_PATH"
    
    if vault kv put $VAULT_PATH $VAULT_KEY="$TEST_VALUE"; then
        log_success "Vault secret updated successfully"
    else
        log_error "Failed to update Vault secret"
        exit 1
    fi
    
    # Step 6: Monitor for propagation
    log_step "Monitoring Secret Propagation"
    
    # Start monitoring in background to capture timing
    monitor_for_changes "$TEST_VALUE" &
    monitor_pid=$!
    
    # Show real-time logs while monitoring
    log_info "Showing real-time pod logs (Ctrl+C to stop log viewing):"
    sleep 2
    
    # Get pod name and show logs
    local pod_name=$(oc get pods -n $NAMESPACE -l app=$DEPLOYMENT -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)
    if [ -n "$pod_name" ]; then
        timeout 60 oc logs -f $pod_name -n $NAMESPACE --tail=10 &
        logs_pid=$!
    fi
    
    # Wait for monitoring to complete
    wait $monitor_pid
    monitor_result=$?
    
    # Stop log tiling if still running
    if [ -n "$logs_pid" ]; then
        kill $logs_pid 2>/dev/null || true
    fi
    
    # Step 7: Final validation and summary
    log_step "Final Validation and Summary"
    
    log_info "Final state check:"
    local final_k8s=$(get_k8s_secret_values)
    local final_app=$(get_app_api_values)
    
    echo "=== K8s Secret Values ==="
    echo "$final_k8s"
    echo ""
    echo "=== App API Values ==="
    echo "$final_app"
    echo ""
    
    log_info "Recent pod logs:"
    get_pod_logs
    
    if [ $monitor_result -eq 0 ]; then
        log_success "🎉 END-TO-END TEST PASSED! Secret propagation working correctly."
        echo ""
        echo "Summary:"
        echo "- Docker image built and deployed successfully"
        echo "- Vault secret updated with value: $TEST_VALUE"
        echo "- Secret propagated to both K8s and App API"
        echo "- Test completed successfully"
        exit 0
    else
        log_error "❌ END-TO-END TEST FAILED! Secret propagation issues detected."
        echo ""
        echo "Troubleshooting steps:"
        echo "1. Check VSO (Vault Secrets Operator) status:"
        echo "   oc get pods -n vault-secrets-operator-system"
        echo "2. Check VaultAuth and VaultStaticSecret resources:"
        echo "   oc get vaultauth,vaultstaticsecret -n $NAMESPACE"
        echo "3. Check VSO logs:"
        echo "   oc logs -n vault-secrets-operator-system -l app.kubernetes.io/name=vault-secrets-operator"
        echo "4. Check application logs for more details:"
        echo "   oc logs deployment/$DEPLOYMENT -n $NAMESPACE"
        exit 1
    fi
}

# Trap to ensure cleanup on script exit
trap 'log_info "Script interrupted, cleaning up..."; kill $(jobs -p) 2>/dev/null || true' INT TERM

# Run main function
main "$@"
