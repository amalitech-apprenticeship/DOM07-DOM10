resource "aws_vpc" "this" {
  cidr_block = "10.0.0.0/16"
  enable_dns_hostnames = true

  tags = {
    Name = "bookstore-vpc"
  }
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id
}

resource "aws_route_table" "this" {
  vpc_id = aws_vpc.this.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this.id
  }
}


resource "aws_subnet" "jenkins-subnet" {
  vpc_id     = aws_vpc.this.id
  cidr_block = "10.0.1.0/24"

  tags = {
    Name = "jenkins-subnet"
  }
}

resource "aws_subnet" "server-subnet" {
  vpc_id     = aws_vpc.this.id
  cidr_block = "10.0.2.0/24"

  tags = {
    Name = "server-subnet"
  }
}

resource "aws_route_table_association" "jenkins-subnet-association" {
  subnet_id      = aws_subnet.jenkins-subnet.id
  route_table_id = aws_route_table.this.id
}

resource "aws_route_table_association" "server-subnet-association" {
  subnet_id      = aws_subnet.server-subnet.id
  route_table_id = aws_route_table.this.id
}
