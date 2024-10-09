FROM localstack/localstack

RUN aws configure set aws_access_key_id test
RUN aws configure set aws_secret_access_key test
RUN aws configure set default.region ap-south-1

COPY ./localstack_setup.sh /etc/localstack/init/ready.d/localstack_setup.sh
RUN chmod +x /etc/localstack/init/ready.d/localstack_setup.sh