/**
 * infra/terraform/main.tf
 *
 * Cloud infrastructure for The Real Earth tile CDN.
 *
 * Resources
 * ---------
 *  - Google Cloud Storage bucket for GeoTIFF tile archives
 *  - Cloud Run service for the FastAPI tile server
 *  - Cloud CDN + HTTPS load balancer for global tile delivery
 *
 * Prerequisites
 * -------------
 *  - GCP project with billing enabled
 *  - Terraform ~1.8
 *  - gcloud auth application-default login
 */

terraform {
  required_version = ">= 1.8"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# ---------------------------------------------------------------------------
# GCS bucket — raw GeoTIFF tile archives
# ---------------------------------------------------------------------------

resource "google_storage_bucket" "tile_store" {
  name          = "${var.project_id}-tile-store"
  location      = var.region
  storage_class = "STANDARD"
  force_destroy = false

  lifecycle_rule {
    condition { age = 365 }
    action { type = "Delete" }
  }

  uniform_bucket_level_access = true
}

# ---------------------------------------------------------------------------
# Artifact Registry — Docker image for Cloud Run
# ---------------------------------------------------------------------------

resource "google_artifact_registry_repository" "repo" {
  location      = var.region
  repository_id = "the-real-earth"
  format        = "DOCKER"
}

# ---------------------------------------------------------------------------
# Cloud Run — FastAPI tile server
# ---------------------------------------------------------------------------

resource "google_cloud_run_v2_service" "tile_server" {
  name     = "tile-server"
  location = var.region

  template {
    containers {
      image = "${var.region}-docker.pkg.dev/${var.project_id}/the-real-earth/tile-server:latest"

      env {
        name  = "TILE_STORE_PATH"
        value = "/tmp/tiles"
      }
      env {
        name  = "GIBS_BASE_URL"
        value = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best"
      }

      resources {
        limits = {
          cpu    = "2"
          memory = "4Gi"
        }
      }
    }

    scaling {
      min_instance_count = 1
      max_instance_count = 10
    }
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }
}

# Allow unauthenticated requests (tile CDN is public)
resource "google_cloud_run_v2_service_iam_member" "public" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.tile_server.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ---------------------------------------------------------------------------
# Outputs
# ---------------------------------------------------------------------------

output "tile_server_url" {
  value       = google_cloud_run_v2_service.tile_server.uri
  description = "Cloud Run tile server URL (set as NEXT_PUBLIC_TILE_SERVER_URL)"
}

output "tile_store_bucket" {
  value       = google_storage_bucket.tile_store.name
  description = "GCS bucket for raw GeoTIFF archives"
}
