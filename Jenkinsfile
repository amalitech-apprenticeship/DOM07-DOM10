pipeline {
  agent any

  options {
    skipDefaultCheckout()
    timestamps()
    timeout(time: 20, unit: 'MINUTES')
    disableConcurrentBuilds()
    buildDiscarder(logRotator(numToKeepStr: '10'))
  }

  triggers {
    pollSCM('H/2 * * * *')
  }
  // Look into webhooks

  environment {
    IMAGE          = "amanamalitrain/bookstore"
    APP_HOST       = '10.0.2.55'
    // look into using the terraform output to get the app host instead of hardcoding it
  }

  stages {
    stage('Checkout') {
      steps {
        checkout scm
        script {
          env.IMAGE_TAG = sh(script: 'git rev-parse --short HEAD', returnStdout: true).trim()
        }
      }
    }

  stage('Node') {
        agent {
          docker {
            image 'node:22'
            reuseNode true
          }
        }
        environment {
          npm_config_cache = "${WORKSPACE}/.npm"
        }
        stages {
          stage('Install') {
            steps {
              dir('app') { sh 'npm ci' }
            }
          }
          stage('Test') {
            steps {
              dir('app') { sh 'npm test' }
            }
          }
        }
    }


    stage('Docker Build') {
      steps {
        script {
          docker.build("${env.IMAGE}:${env.IMAGE_TAG}", 'app')
        }
      }
    }

    stage('Push Image') {
      steps {
        script {
          docker.withRegistry('', 'registry_creds') {
            docker.image("${env.IMAGE}:${env.IMAGE_TAG}").push()
          }
        }
      }
    }

    stage('Deploy') {
      steps {
        sshagent(credentials: ['ec2_ssh']) {
          sh 'ssh -o StrictHostKeyChecking=no ec2-user@"$APP_HOST" "bash -s -- $IMAGE:$IMAGE_TAG" < scripts/deploy.sh'
        }
      }
    }
  }

  post {
    always {
      sh '''
        docker rmi "$IMAGE:$IMAGE_TAG" "$IMAGE:latest" || true
        docker image prune -f
      '''
    }
    cleanWs()
  }
}