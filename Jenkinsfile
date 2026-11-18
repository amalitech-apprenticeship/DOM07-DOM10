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

  environment {
    DOCKERHUB_USER = 'your-dockerhub-username'
    IMAGE          = "${DOCKERHUB_USER}/bookstore"
    APP_HOST       = '10.0.x.x'   // the app server's PRIVATE IP
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

    stage('Install/Build') {
      steps {
        dir('app') { sh 'npm ci' }
      }
    }

    stage('Test') {
      steps {
        dir('app') { sh 'npm test' }
      }
    }

    stage('Docker Build') {
      steps {
        dir('app') {
          sh 'docker build -t "$IMAGE:$IMAGE_TAG" -t "$IMAGE:latest" .'
        }
      }
    }

    stage('Push Image') {
      steps {
        withCredentials([usernamePassword(credentialsId: 'registry_creds',
                                          usernameVariable: 'REG_USER',
                                          passwordVariable: 'REG_PASS')]) {
          sh '''
            echo "$REG_PASS" | docker login -u "$REG_USER" --password-stdin
            docker push "$IMAGE:$IMAGE_TAG"
            docker push "$IMAGE:latest"
          '''
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
        docker logout || true
        docker rmi "$IMAGE:$IMAGE_TAG" "$IMAGE:latest" || true
        docker image prune -f
      '''
    }
  }
}