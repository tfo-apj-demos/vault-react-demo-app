#!/bin/bash

# Quick Vault Secrets Monitoring Script
# This script just tests the propagation without rebuilding

set -e

# Configuration
NAMESPACE="vault-live-secrets-demo"
DEPLOYMENT="vault-live-secrets-demo"
SECRET_NAME="vault-web-secrets"
APP_URL="https://vault-live-secrets-demo-vault-live-secrets-demo.apps.openshift-01.hashicorp.local"
TEST_VALUE="frozen$(date +%s)"
VAULT_PATH="secrets/dev"
VAULT_KEY="somethingnew"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Functions (same as main script but simplified)
get_k8s_secret_values() {
    kubectl get secret $SECRET_NAME -n $NAMESPACE -o jsonpath='{.data}' 2>/dev/null | jq -r 'to_entries[] | "\(.key): \(.value | @base64d)"' 2>/dev/null || echo "Error reading secret"
}

get_app_api_values() {
    curl -s -k "$APP_URL/api/secrets" | jq -r '.secrets | to_entries[] | "\(.key): \(.value.content)"' 2>/dev/null || echo "Error reading API"
}

extract_value() {
    local output="$1"
    local key="$2"
    echo "$output" | grep "^$key:" | cut -d':' -f2- | xargs
}

get_pod_logs() {
    local pod_name=$(oc get pods -n $NAMESPACE -l app=$DEPLOYMENT -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)
    if [ -n "$pod_name" ]; then
        echo "Recent logs from $pod_name:"
        oc logs $pod_name -n $NAMESPACE --tail=30 | tail -15
    fi
}

# Quick monitoring function
quick_monitor() {
    local expected_value="$1"
    local max_wait=90
    local check_interval=3
    local elapsed=0
    
    log_info "Quick monitoring for '$expected_value' (${max_wait}s max)..."
    
    # Show initial state
    echo "=== INITIAL STATE ==="
    echo "K8s Secret:"
    get_k8s_secret_values | grep -E "(somethingnew|apikey|database)" | head -3
    echo "App API:"
    get_app_api_values | grep -E "(somethingnew|apikey|database)" | head -3
    echo ""
    
    while [ $elapsed -lt $max_wait ]; do
        local k8s_value=$(extract_value "$(get_k8s_secret_values)" "$VAULT_KEY")
        local app_value=$(extract_value "$(get_app_api_values)" "$VAULT_KEY")
        
        printf "T+%3ds | K8s: %-15s | App: %-15s" "$elapsed" "'$k8s_value'" "'$app_value'"
        
        if [ "$k8s_value" = "$expected_value" ] && [ "$app_value" = "$expected_value" ]; then
            echo -e " ${GREEN}✓ SUCCESS!${NC}"
            return 0
        elif [ "$k8s_value" = "$expected_value" ]; then
            echo -e " ${YELLOW}K8s ✓, App pending${NC}"
        elif [ "$app_value" = "$expected_value" ]; then
            echo -e " ${YELLOW}App ✓, K8s pending${NC}"
        else
            echo " ⏳"
        fi
        
        sleep $check_interval
        ((elapsed += check_interval))
    done
    
    echo -e "${RED}✗ Timeout after ${max_wait}s${NC}"
    return 1
}

main() {
    # Quick checks
    if ! oc whoami &> /dev/null; then
        log_error "Not logged into OpenShift"
        exit 1
    fi
    
    if ! vault status &> /dev/null; then
        log_error "Vault not accessible"
        exit 1
    fi
    
    # Check app accessibility
    if ! curl -s -f -k "$APP_URL/api/health" > /dev/null; then
        log_warning "App may not be accessible at $APP_URL"
    fi
    
    echo "=== QUICK VAULT SECRETS TEST ==="
    echo "Namespace: $NAMESPACE"
    echo "App URL: $APP_URL"
    echo "Test value: $TEST_VALUE"
    echo ""
    
    # Update vault
    log_info "Updating Vault secret..."
    if vault kv put $VAULT_PATH $VAULT_KEY="$TEST_VALUE"; then
        log_success "Vault updated"
    else
        log_error "Vault update failed"
        exit 1
    fi
    
    # Start monitoring with live logs
    quick_monitor "$TEST_VALUE" &
    monitor_pid=$!
    
    # Show live logs for a bit
    echo ""
    echo "=== LIVE LOGS ==="
    local pod_name=$(oc get pods -n $NAMESPACE -l app=$DEPLOYMENT -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)
    if [ -n "$pod_name" ]; then
        timeout 30 oc logs -f $pod_name -n $NAMESPACE --tail=5 2>/dev/null &
        logs_pid=$!
    fi
    
    # Wait for monitoring
    wait $monitor_pid
    result=$?
    
    # Stop logs
    kill $logs_pid 2>/dev/null || true
    
    echo ""
    echo "=== FINAL STATE ==="
    echo "K8s Secret:"
    get_k8s_secret_values | grep -E "(somethingnew|apikey|database)" | head -5
    echo "App API:"
    get_app_api_values | grep -E "(somethingnew|apikey|database)" | head -5
    
    echo ""
    echo "=== RECENT LOGS ==="
    get_pod_logs
    
    if [ $result -eq 0 ]; then
        log_success "🎉 Test PASSED - Secret propagation working!"
    else
        log_error "❌ Test FAILED - Check logs above for issues"
    fi
    
    exit $result
}

trap 'kill $(jobs -p) 2>/dev/null || true' INT TERM
main "$@"
